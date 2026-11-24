"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CAPTAIN_MULTIPLIER,
  LINEUP_SIZE,
  MAX_PER_TEAM,
  ROLES,
  ROLE_BONUS,
  ROLE_INFO,
  TIERS,
  TIER_LABEL,
  validateLineup,
  type FantasyPlayer,
  type Lineup,
  type Role,
  type Tier,
} from "@/lib/fantasy-core";
import { PlayerFace } from "./PlayerFace";

type Slots = Partial<Record<Tier, { playerId: number; role: Role }>>;

const SAVE_ERRORS: Record<string, string> = {
  stage_not_open: "This stage isn't open for drafting yet.",
  stage_final: "This stage is over.",
  lineup_locked: "Your lineup for this stage is locked. It was saved after the stage started.",
  event_archived: "This Major is over.",
  invalid_lineup: "That lineup didn't go through. Reload and try again.",
  "Not authenticated": "Sign in to save a lineup.",
};

/**
 * The lineup builder: five tier slots over the stage's player pool. Tap a
 * player to put him in his tier's slot, give each of the five a role card, and
 * crown one captain. The same rules run again on the server when you save.
 */
export function FantasyDraft({
  stageId,
  stageName,
  pool,
  initial,
  initialTeamName,
  mode,
}: {
  stageId: number;
  stageName: string;
  pool: FantasyPlayer[];
  initial: Lineup | null;
  initialTeamName: string;
  /** "edit": the stage is open. "join-late": the stage is live, one entry only. */
  mode: "edit" | "join-late";
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);

  const [slots, setSlots] = useState<Slots>(() => {
    const s: Slots = {};
    for (const slot of initial?.slots ?? []) {
      const p = byId.get(slot.playerId);
      if (p) s[p.tier] = { playerId: slot.playerId, role: slot.role };
    }
    return s;
  });
  const [captainId, setCaptainId] = useState<number | null>(initial?.captainId ?? null);
  const [teamName, setTeamName] = useState(initialTeamName);
  const [tier, setTier] = useState<Tier>(() => TIERS.find((t) => !slots[t]) ?? "diamond");
  const [teamFilter, setTeamFilter] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const picked = TIERS.flatMap((t) => (slots[t] ? [byId.get(slots[t]!.playerId)!] : []));
  const perTeam = new Map<number, number>();
  for (const p of picked) perTeam.set(p.teamPickid, (perTeam.get(p.teamPickid) ?? 0) + 1);
  const teams = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of pool) m.set(p.teamPickid, p.teamName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [pool]);

  const lineup: Lineup | null =
    picked.length === LINEUP_SIZE && captainId != null
      ? { slots: TIERS.map((t) => slots[t]!), captainId }
      : null;
  const problems = lineup ? validateLineup(lineup, pool) : [];
  const ready = lineup != null && problems.length === 0;

  function touch() {
    setDirty(true);
    setMessage(null);
  }

  function place(p: FantasyPlayer) {
    const current = slots[p.tier];
    if (current?.playerId === p.id) return remove(p.tier);
    const usedRoles = new Set(TIERS.filter((t) => t !== p.tier && slots[t]).map((t) => slots[t]!.role));
    const role = current?.role ?? ROLES.find((r) => !usedRoles.has(r)) ?? ROLES[0];
    const next = { ...slots, [p.tier]: { playerId: p.id, role } };
    setSlots(next);
    if (captainId == null || captainId === current?.playerId) setCaptainId(p.id);
    const nextEmpty = TIERS.find((t) => !next[t]);
    if (nextEmpty) setTier(nextEmpty);
    touch();
  }

  function remove(t: Tier) {
    const gone = slots[t];
    if (!gone) return;
    const next = { ...slots };
    delete next[t];
    setSlots(next);
    if (captainId === gone.playerId) {
      const other = TIERS.find((x) => next[x]);
      setCaptainId(other ? next[other]!.playerId : null);
    }
    setTier(t);
    touch();
  }

  /** Give a slot a role; if another slot holds it, the two swap. */
  function setRole(t: Tier, role: Role) {
    const mine = slots[t];
    if (!mine || mine.role === role) return;
    const next = { ...slots };
    const holder = TIERS.find((x) => x !== t && next[x]?.role === role);
    if (holder) next[holder] = { ...next[holder]!, role: mine.role };
    next[t] = { ...mine, role };
    setSlots(next);
    touch();
  }

  async function save() {
    if (!lineup || !ready || saving) return;
    if (
      mode === "join-late" &&
      !window.confirm(
        `${stageName} has already started. You get one entry: it can't be changed, and it scores only matches that start from now on. Lock it in?`,
      )
    ) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/fantasy/lineup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId, lineup, teamName }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; problems?: string[] };
      if (!res.ok) {
        const text = json.problems?.length ? json.problems.join(" ") : (SAVE_ERRORS[json.error ?? ""] ?? "Couldn't save. Try again.");
        setMessage({ kind: "err", text });
      } else {
        setDirty(false);
        setMessage({
          kind: "ok",
          text: mode === "join-late" ? "Locked in. You score from the next match." : "Saved. You can change it until the stage starts.",
        });
        router.refresh();
      }
    } catch {
      setMessage({ kind: "err", text: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  const q = query.trim().toLowerCase();
  const shown = pool.filter(
    (p) =>
      p.tier === tier &&
      (teamFilter === "all" || p.teamPickid === teamFilter) &&
      (q === "" || p.name.toLowerCase().includes(q) || p.teamName.toLowerCase().includes(q)),
  );

  const status = !lineup
    ? picked.length < LINEUP_SIZE
      ? `${picked.length} of ${LINEUP_SIZE} picked`
      : "Pick a captain"
    : problems[0] ?? (dirty || !initial ? "Ready to save" : "Saved");

  return (
    <div className="fx-draft">
      <label className="field fx-teamname">
        <span>Team name</span>
        <input
          className="input"
          value={teamName}
          maxLength={28}
          placeholder="Name your team"
          onChange={(e) => {
            setTeamName(e.target.value);
            touch();
          }}
        />
      </label>

      <div className="fx-slots" role="list" aria-label="Your five">
        {TIERS.map((t) => {
          const slot = slots[t];
          const p = slot ? byId.get(slot.playerId) : undefined;
          const isCaptain = p != null && captainId === p.id;
          return (
            <div key={t} role="listitem" className={`fx-slot ${t}${p ? " filled" : ""}${tier === t ? " armed" : ""}`}>
              <button type="button" className="fx-slot-head" onClick={() => setTier(t)} aria-label={`Show ${TIER_LABEL[t]} players`}>
                <span className={`fx-tier ${t}`}>{TIER_LABEL[t]}</span>
                <span className="fx-slot-mult">C ×{CAPTAIN_MULTIPLIER[t].toFixed(1)}</span>
              </button>
              {p && slot ? (
                <div className="fx-slot-body">
                  <PlayerFace src={p.photo} name={p.name} size={56} />
                  <div className="fx-slot-who">
                    <span className="fx-slot-name">{p.name}</span>
                    <span className="fx-slot-team">{p.teamName}</span>
                  </div>
                  <div className="fx-slot-ctl">
                    <label className="fx-role">
                      <span className="rk-sr">Role for {p.name}</span>
                      <select value={slot.role} onChange={(e) => setRole(t, e.target.value as Role)} title={ROLE_INFO[slot.role].rule}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_INFO[r].label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className={`fx-cap${isCaptain ? " on" : ""}`}
                      aria-pressed={isCaptain}
                      onClick={() => {
                        setCaptainId(p.id);
                        touch();
                      }}
                      title={isCaptain ? "Captain" : "Make captain"}
                    >
                      C
                    </button>
                    <button type="button" className="fx-x" onClick={() => remove(t)} aria-label={`Remove ${p.name}`}>
                      ×
                    </button>
                  </div>
                  <span className="fx-slot-rule">{ROLE_INFO[slot.role].rule} · +{ROLE_BONUS}</span>
                </div>
              ) : (
                <button type="button" className="fx-slot-empty" onClick={() => setTier(t)}>
                  Pick a {TIER_LABEL[t]}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="fx-pool">
        <div className="fx-pool-tabs" role="tablist" aria-label="Tier">
          {TIERS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tier === t} className={`${tier === t ? "on " : ""}${slots[t] ? "done" : ""}`} onClick={() => setTier(t)}>
              {TIER_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="fx-pool-filters">
          <input
            className="fx-search"
            type="search"
            placeholder="Search player or team"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search player or team"
          />
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value === "all" ? "all" : Number(e.target.value))} aria-label="Team">
            <option value="all">All teams</option>
            {teams.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <ul className="fx-pool-list">
          {shown.map((p) => {
            const selected = slots[p.tier]?.playerId === p.id;
            const holder = slots[p.tier] ? byId.get(slots[p.tier]!.playerId) : undefined;
            // Replacing the slot's holder frees his team's place first.
            const teamCount = (perTeam.get(p.teamPickid) ?? 0) - (holder && holder.teamPickid === p.teamPickid ? 1 : 0);
            const capped = !selected && teamCount >= MAX_PER_TEAM;
            return (
              <li key={p.id}>
                <button type="button" className={`fx-pl${selected ? " on" : ""}`} disabled={capped} aria-pressed={selected} onClick={() => place(p)}>
                  <PlayerFace src={p.photo} name={p.name} size={40} />
                  <span className="fx-pl-who">
                    <span className="fx-pl-name">
                      {p.name}
                      {p.standIn && <span className="tag">stand-in</span>}
                    </span>
                    <span className="fx-pl-team">
                      {p.teamName} · {p.position}
                      {capped && ` · ${MAX_PER_TEAM} max per team`}
                    </span>
                  </span>
                  <span className="fx-pl-rating mono">{p.rating != null ? p.rating.toFixed(2) : "–"}</span>
                  <span className="fx-pl-add" aria-hidden>
                    {selected ? "✓" : "+"}
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="fx-empty">No {TIER_LABEL[tier]} players match that.</li>}
        </ul>
      </div>

      <div className="fx-bar" role="status">
        <span className={`fx-bar-msg${message ? ` ${message.kind}` : ""}`}>{message?.text ?? status}</span>
        <button type="button" className="btn-solid" disabled={!ready || saving || (!dirty && initial != null)} onClick={save}>
          {saving ? "Saving…" : mode === "join-late" ? "Lock in" : initial ? "Save changes" : "Save lineup"}
        </button>
      </div>
    </div>
  );
}
