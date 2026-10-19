"""
render-coin.py — step 2 of the challenge-coin pipeline (#1278): Blender/Cycles.

Turns a relief from build-coin-maps.py into a real struck coin — a dense polar
mesh displaced by the height field (die-struck device + lettering), a raised
rim with a rounded lip, a reeded (milled) edge wall, tier PBR metal in a proof
finish (satin relief over a mirror field, cavity patina), a glossy enamel band
(glitter enamel + two brilliant-cut stones for diamond) — lit by a studio
softbox rig and rendered on a transparent background.

  --mode face     straight-on orthographic face, cropped to the disc
                  (public/coins/<slug>-<tier>.png and _back-<tier>.png)
  --mode beauty   3/4 hero angle showing the reeded edge (public/coins/beauty-*)
  --mode felt     the felt compartment tile for the profile case (no coin)

Tier looks live in TIERS below (metal, enamel, patina). Renders take ~2.5 min a
face on a Quadro K2200 (CUDA) at --res 1024 / 160 samples, denoised.

RE-RENDER FOR THE NEXT MAJOR (only the four FRONT faces change; the backs, the
felt and the CS2/HOTLINE reverse are shared — leave them):
  1. Get the Major's logo as a PNG on a transparent background.
  2. Build the reliefs (Pillow + numpy + scipy; font: Big Shoulders Display 800,
     fonts.google.com — the site's display face):
       for t in diamond gold silver bronze; do
         python3 scripts/coins/build-coin-maps.py --out work/front-$t \
           --logo <logo.png> [--logo-invert-lum if dark ink] --top "CHALLENGE COIN" \
           --bottom "$(echo $t | tr a-z A-Z)" $( [ $t = diamond ] && echo --gems ) \
           --font BigShouldersDisplay-ExtraBold.ttf
       done
     Open work/front-gold.preview.png to check the layout (logo fit: --logo-w/-h/-y).
     A tall shield mark needs its own fit — PGL Singapore 2026 (Liquipedia's
     2000px "darkmode" PNG; a white copy is public/watch/pgl-singapore.png) used
     --logo-w 0.80 --logo-h 1.12 --logo-y -0.03.
  3. Render each tier (Blender 4.5 — e.g. the blendergrid/blender:4.5 image,
     whose entrypoint is `blender -b -noaudio`):
       blender -b -noaudio --python scripts/coins/render-coin.py -- \
         --height work/front-gold.height.npy --mask work/front-gold.mask.png \
         --tier gold --mode face --res 1024 --samples 160 --out work/front-gold.png
     (add --gems for diamond; --cpu if there's no CUDA device).
  4. Ship: python3 scripts/coins/finish-coin.py face work/front-gold.png \
       public/coins/<event-slug>-gold.png   (crops to the disc, 640px, pngquant)
  The reverse is the same recipe with --logo public/watch/counter-strike.png
  --logo-w 1.08 --logo-h 0.26 --logo-y -0.14 --sub-logo public/brand/symbol-white.png
  --sub-logo-h 0.30 --sub-logo-y 0.24 --top "HOTLINE PICK'EM"
  --bottom "MAJOR CHALLENGE COIN" (one map; --gems for the diamond reverse).
"""

import argparse
import math
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--height")
ap.add_argument("--mask")
ap.add_argument("--tier", default="gold")
ap.add_argument("--mode", default="face", choices=["face", "beauty", "felt"])
ap.add_argument("--out", required=True)
ap.add_argument("--res", type=int, default=1024)
ap.add_argument("--samples", type=int, default=160)
ap.add_argument("--gems", action="store_true")
ap.add_argument("--rings", type=int, default=900)
ap.add_argument("--segs", type=int, default=3072)
ap.add_argument("--cpu", action="store_true")
ap.add_argument("--felt-color", default="0.008,0.016,0.030")
args = ap.parse_args(argv)

# ── scene / render setup ─────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
cy = scene.cycles
if not args.cpu:
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "CUDA"
        cy.device = "GPU"
    except Exception as e:  # pragma: no cover — CPU fallback
        print("GPU unavailable, CPU render:", e)
cy.samples = args.samples
cy.use_denoising = True
cy.max_bounces = 16
cy.glossy_bounces = 8
cy.transmission_bounces = 16
cy.transparent_max_bounces = 8
cy.caustics_reflective = True
cy.caustics_refractive = True
cy.blur_glossy = 0.5
scene.render.film_transparent = True
scene.render.resolution_x = args.res
scene.render.resolution_y = args.res
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "16"
scene.view_settings.view_transform = "Filmic"
scene.view_settings.look = "Medium High Contrast"

R = 1.0           # coin radius (scene units)
FELT_H = 2.6      # felt compartment height (width 2.0) — keep in sync with sg-coins.css
T = 0.15          # body thickness (excluding relief)
RELIEF = 0.034    # height-field 1.0 → world units

# ── tier palettes (linear) ──────────────────────────────────────────────────
TIERS = {
    #            metal base            frosted mult  enamel colour             AO patina
    "diamond": ((0.86, 0.89, 0.93), 0.80, (0.010, 0.050, 0.170), 0.25),
    "gold":    ((1.00, 0.60, 0.20), 0.78, (0.0045, 0.0042, 0.004), 0.30),
    "silver":  ((0.93, 0.93, 0.92), 0.70, (0.0045, 0.0045, 0.005), 0.45),
    "bronze":  ((0.74, 0.40, 0.20), 0.62, (0.042, 0.004, 0.003), 0.60),
}


def node(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        if k == "loc":
            n.location = v
        else:
            setattr(n, k, v)
    return n


def principled(nt, **inputs):
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    for k, v in inputs.items():
        p.inputs[k].default_value = v
    return p


# ── coin mesh ────────────────────────────────────────────────────────────────
def build_coin(height_path):
    H = np.load(height_path).astype(np.float32)
    N = H.shape[0]
    NR, NS = args.rings, args.segs

    def sample(xu, yu):
        # bilinear sample; image row 0 is +y (top)
        px = (xu + 1) * N / 2.0 - 0.5
        py = (1 - yu) * N / 2.0 - 0.5
        x0 = np.clip(np.floor(px).astype(np.int64), 0, N - 2)
        y0 = np.clip(np.floor(py).astype(np.int64), 0, N - 2)
        fx = np.clip(px - x0, 0, 1)
        fy = np.clip(py - y0, 0, 1)
        a = H[y0, x0] * (1 - fx) + H[y0, x0 + 1] * fx
        b = H[y0 + 1, x0] * (1 - fx) + H[y0 + 1, x0 + 1] * fx
        return a * (1 - fy) + b * fy

    th = np.linspace(0, 2 * np.pi, NS, endpoint=False)
    ct, st = np.cos(th), np.sin(th)
    rings = np.arange(1, NR + 1) / NR * R
    # top face (relief) — centre + NR rings
    rx = rings[:, None] * ct[None, :]
    ry = rings[:, None] * st[None, :]
    rz = T / 2 + sample(rx, ry) * RELIEF
    top = np.stack([rx, ry, rz], -1).reshape(-1, 3)
    centre_z = T / 2 + float(sample(np.array([0.0]), np.array([0.0]))[0]) * RELIEF
    verts = [np.array([[0, 0, centre_z]]), top]
    top_outer_z = rz[-1].mean()

    # reeded wall: K rows from the rim's rounded lip down to the bottom lip
    REEDS = NS // 16
    phase = (th * REEDS) % (2 * np.pi)
    groove = np.clip(np.cos(phase) * 1.6, -1, 1) * 0.5 + 0.5  # flat-topped reeds
    K = 14
    zs = np.linspace(top_outer_z - 0.004, -T / 2 - 0.4 * RELIEF + 0.004, K)
    wall = []
    for k, z in enumerate(zs):
        u = k / (K - 1)
        taper = np.clip(min(u, 1 - u) / 0.12, 0, 1)  # reeds die out at the lips
        rr = R * (1.0 - 0.006 * (1 - groove) * taper) + 0.0005 * math.sin(u * math.pi)
        wall.append(np.stack([rr * ct, rr * st, np.full(NS, z)], -1))
    verts.append(np.concatenate(wall))
    # bottom: plain flat face with rounded lip ring, then centre
    b1 = np.stack([0.975 * ct, 0.975 * st, np.full(NS, -T / 2 - RELIEF * 0.95)], -1)
    verts.append(b1)
    verts.append(np.array([[0, 0, -T / 2 - RELIEF * 0.95]]))
    V = np.concatenate(verts).astype(np.float32)

    def ring_idx(i):  # top ring i (1-based)
        return 1 + (i - 1) * NS + np.arange(NS)

    wall_base = 1 + NR * NS
    def wall_idx(k):
        return wall_base + k * NS + np.arange(NS)

    b1_idx = wall_base + K * NS + np.arange(NS)
    bc = wall_base + K * NS + NS

    quads, tris = [], []
    j = np.arange(NS)
    jn = (j + 1) % NS
    r1 = ring_idx(1)
    tris.append(np.stack([np.zeros(NS, np.int64), r1[j], r1[jn]], -1))
    # top rings
    a = (1 + (np.arange(NR - 1)[:, None]) * NS + j[None, :])
    b = (1 + (np.arange(NR - 1)[:, None]) * NS + jn[None, :])
    quads.append(np.stack([a, a + NS, b + NS, b], -1).reshape(-1, 4))  # CCW from +z
    # top outer ring → wall row 0 → … → wall row K-1 (outward normals: reverse winding)
    rows = [ring_idx(NR)] + [wall_idx(k) for k in range(K)] + [b1_idx]
    for ra, rb in zip(rows[:-1], rows[1:]):
        quads.append(np.stack([ra[j], rb[j], rb[jn], ra[jn]], -1))
    tris.append(np.stack([np.full(NS, bc), b1_idx[jn], b1_idx[j]], -1))

    Q = np.concatenate(quads)
    Tr = np.concatenate(tris)
    loops = np.concatenate([Q.ravel(), Tr.ravel()]).astype(np.int32)
    sizes = np.concatenate([np.full(len(Q), 4), np.full(len(Tr), 3)])
    starts = np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.int32)

    me = bpy.data.meshes.new("coin")
    me.vertices.add(len(V))
    me.vertices.foreach_set("co", V.ravel())
    me.loops.add(len(loops))
    me.loops.foreach_set("vertex_index", loops)
    me.polygons.add(len(sizes))
    me.polygons.foreach_set("loop_start", starts)
    try:
        me.polygons.foreach_set("loop_total", sizes.astype(np.int32))
    except Exception:
        pass
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    try:
        me.shade_smooth()
    except Exception:
        me.polygons.foreach_set("use_smooth", np.ones(len(sizes), bool))
    ob = bpy.data.objects.new("Coin", me)
    scene.collection.objects.link(ob)
    return ob


def coin_material(mask_path, tier):
    metal, frost_mult, enamel_col, patina = TIERS[tier]
    m = bpy.data.materials.new("coin")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = node(nt, "ShaderNodeOutputMaterial")
    tc = node(nt, "ShaderNodeTexCoord")
    mp = node(nt, "ShaderNodeMapping")
    mp.inputs["Location"].default_value = (0.5, 0.5, 0)
    mp.inputs["Scale"].default_value = (0.5, 0.5, 1)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    img = node(nt, "ShaderNodeTexImage")
    img.image = bpy.data.images.load(mask_path)
    img.image.colorspace_settings.name = "Non-Color"
    img.extension = "EXTEND"
    nt.links.new(mp.outputs["Vector"], img.inputs["Vector"])
    sep = node(nt, "ShaderNodeSeparateColor")
    nt.links.new(img.outputs["Color"], sep.inputs["Color"])

    # cavity patina: AO darkens recesses so the struck relief reads (antique finish)
    ao = node(nt, "ShaderNodeAmbientOcclusion", samples=12)
    ao.inputs["Distance"].default_value = 0.035
    pat = node(nt, "ShaderNodeMapRange")
    pat.inputs["To Min"].default_value = 1 - patina
    nt.links.new(ao.outputs["AO"], pat.inputs["Value"])

    def tinted(mult):
        mix = node(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["A"].default_value = (*[c * mult for c in metal], 1)
        nt.links.new(pat.outputs["Result"], mix.inputs["B"])
        return mix

    # proof finish: satin (lightly frosted) relief + rim …
    pol = principled(nt, **{"Metallic": 1.0, "Roughness": 0.34})
    nt.links.new(tinted(1.0).outputs["Result"], pol.inputs["Base Color"])
    if tier == "diamond":
        pol.inputs["Anisotropic"].default_value = 0.0
    # … over a mirror-polished field (the dark, glossy ground of a proof strike)
    fro = principled(nt, **{"Metallic": 1.0, "Roughness": 0.045})
    nt.links.new(tinted(frost_mult).outputs["Result"], fro.inputs["Base Color"])
    noi = node(nt, "ShaderNodeTexNoise")
    noi.inputs["Scale"].default_value = 900.0
    noi.inputs["Detail"].default_value = 2.0
    bmp = node(nt, "ShaderNodeBump")
    bmp.inputs["Strength"].default_value = 0.012
    bmp.inputs["Distance"].default_value = 0.0005
    nt.links.new(noi.outputs["Fac"], bmp.inputs["Height"])
    nt.links.new(bmp.outputs["Normal"], fro.inputs["Normal"])
    # glossy enamel fill
    ena = principled(nt, **{"Metallic": 0.0, "Roughness": 0.05, "Base Color": (*enamel_col, 1),
                            "Coat Weight": 1.0, "Coat Roughness": 0.02})
    if tier == "diamond":
        # glitter enamel: ice-blue fill seeded with crystalline flakes — each
        # Voronoi cell tilts its normal at random so the band sparkles.
        ena.inputs["Roughness"].default_value = 0.08
        vor = node(nt, "ShaderNodeTexVoronoi")
        vor.inputs["Scale"].default_value = 260.0
        nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
        jit = node(nt, "ShaderNodeMapRange", data_type="FLOAT_VECTOR")
        nt.links.new(vor.outputs["Color"], jit.inputs["Vector"])
        jit.inputs[9].default_value = (-0.55, -0.55, 1.0)   # To Min
        jit.inputs[10].default_value = (0.55, 0.55, 1.0)    # To Max
        nrm = node(nt, "ShaderNodeVectorMath", operation="NORMALIZE")
        nt.links.new(jit.outputs["Vector"], nrm.inputs[0])
        flake = principled(nt, **{"Metallic": 1.0, "Roughness": 0.10, "Base Color": (0.55, 0.75, 1.0, 1)})
        nt.links.new(nrm.outputs["Vector"], flake.inputs["Normal"])
        sel = node(nt, "ShaderNodeMath", operation="GREATER_THAN")
        sel.inputs[1].default_value = 0.80
        nt.links.new(vor.outputs["Color"], sel.inputs[0])
        fm = node(nt, "ShaderNodeMixShader")
        nt.links.new(sel.outputs["Value"], fm.inputs["Fac"])
        nt.links.new(ena.outputs["BSDF"], fm.inputs[1])
        nt.links.new(flake.outputs["BSDF"], fm.inputs[2])
        ena_out = fm.outputs["Shader"]
    else:
        ena_out = ena.outputs["BSDF"]

    m1 = node(nt, "ShaderNodeMixShader")
    nt.links.new(sep.outputs["Red"], m1.inputs["Fac"])
    nt.links.new(fro.outputs["BSDF"], m1.inputs[1])
    nt.links.new(pol.outputs["BSDF"], m1.inputs[2])
    m2 = node(nt, "ShaderNodeMixShader")
    nt.links.new(sep.outputs["Green"], m2.inputs["Fac"])
    nt.links.new(m1.outputs["Shader"], m2.inputs[1])
    nt.links.new(ena_out, m2.inputs[2])
    nt.links.new(m2.outputs["Shader"], out.inputs["Surface"])
    return m


def gem_collection():
    c = bpy.data.collections.get("gems")
    if c is None:
        c = bpy.data.collections.new("gems")
        scene.collection.children.link(c)
    return c


def gem(name, loc, radius):
    """Round brilliant (approximation): 16-fold table / crown / girdle / pavilion."""
    import bmesh
    bm = bmesh.new()
    n = 16
    def ring(r, z, off=0.0):
        return [bm.verts.new((r * math.cos(2 * math.pi * (i + off) / n),
                              r * math.sin(2 * math.pi * (i + off) / n), z)) for i in range(n)]
    table = ring(0.55 * radius, 0.16 * radius, 0.5)
    crown = ring(0.80 * radius, 0.09 * radius, 0.0)
    gir_t = ring(radius, 0.015 * radius, 0.5)
    gir_b = ring(radius, -0.015 * radius, 0.5)
    pav = ring(0.55 * radius, -0.25 * radius, 0.0)
    apex = bm.verts.new((0, 0, -0.43 * radius))
    bm.faces.new(table)
    for i in range(n):
        k = (i + 1) % n
        bm.faces.new((table[i], crown[k], table[k]))
        bm.faces.new((table[i], crown[i], crown[k]))
        bm.faces.new((crown[i], gir_t[i], crown[k]))
        bm.faces.new((crown[k], gir_t[i], gir_t[k]))
        bm.faces.new((gir_t[i], gir_b[i], gir_b[k], gir_t[k]))
        bm.faces.new((gir_b[i], pav[k], gir_b[k]))
        bm.faces.new((gir_b[i], pav[i], pav[k]))
        bm.faces.new((pav[i], apex, pav[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    gem_collection().objects.link(ob)
    m = bpy.data.materials.get("gem")
    if m is None:
        m = bpy.data.materials.new("gem")
        m.use_nodes = True
        p = m.node_tree.nodes["Principled BSDF"]
        p.inputs["Base Color"].default_value = (0.92, 0.97, 1.0, 1)
        p.inputs["Transmission Weight"].default_value = 1.0
        p.inputs["Roughness"].default_value = 0.0
        p.inputs["IOR"].default_value = 2.42
        try:
            p.inputs["Dispersion"].default_value = 0.6
        except KeyError:
            pass
    me.materials.append(m)
    return ob


# ── lighting rig ─────────────────────────────────────────────────────────────
def emission_plane(name, size, loc, rot, strength, gradient=True, camera_visible=False):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.visible_camera = camera_visible
    ob.visible_shadow = False
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = node(nt, "ShaderNodeOutputMaterial")
    em = node(nt, "ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    if gradient:
        # softbox: bright diagonal sweep falling to dark — the flat polished
        # tops reflect this 1:1 in an orthographic face shot (classic sheen).
        tc = node(nt, "ShaderNodeTexCoord")
        sep = node(nt, "ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
        mth = node(nt, "ShaderNodeMath", operation="ADD")
        nt.links.new(sep.outputs["X"], mth.inputs[0])
        nt.links.new(sep.outputs["Y"], mth.inputs[1])
        ramp = node(nt, "ShaderNodeValToRGB")
        cr = ramp.color_ramp
        cr.interpolation = "B_SPLINE"
        cr.elements[0].position = 0.0
        cr.elements[0].color = (0.01, 0.01, 0.01, 1)
        cr.elements[1].position = 1.0
        cr.elements[1].color = (0.01, 0.01, 0.01, 1)
        for pos, v in ((0.62, 0.015), (0.74, 0.30), (0.80, 0.55), (0.86, 0.22), (0.95, 0.012), (1.20, 0.01), (1.27, 0.12), (1.33, 0.01)):
            e = cr.elements.new(pos / 2.0)
            e.color = (v, v, v, 1)
        nt.links.new(mth.outputs["Value"], ramp.inputs["Fac"])
        # ramp expects 0..1; X+Y spans 0..2
        half = node(nt, "ShaderNodeMath", operation="MULTIPLY")
        half.inputs[1].default_value = 0.5
        nt.links.new(mth.outputs["Value"], half.inputs[0])
        nt.links.new(half.outputs["Value"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    ob.data.materials.append(m)
    return ob


def area(name, loc, target, size, energy, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.size = size
    ld.energy = energy
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    scene.collection.objects.link(ob)
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    ob.visible_camera = False
    return ob


def world(strength):
    w = bpy.data.worlds.new("w")
    scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    try:
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        import os
        env.image = bpy.data.images.load(os.path.join(
            bpy.utils.system_resource("DATAFILES"), "studiolights", "world", "studio.exr"))
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    except Exception as e:
        print("no studio hdri", e)
        bg.inputs["Color"].default_value = (0.02, 0.02, 0.02, 1)
    bg.inputs["Strength"].default_value = strength


def camera(ortho, loc, target, lens=85, scale=2.0):
    cd = bpy.data.cameras.new("cam")
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = scale
    else:
        cd.lens = lens
    cd.clip_start = 0.01
    cd.clip_end = 100
    ob = bpy.data.objects.new("cam", cd)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(ob)
    scene.camera = ob
    return ob


# ── felt slot tile ───────────────────────────────────────────────────────────
def felt_tile():
    """A compartment of deep felt: a recessed circular coin well up top and a
    plain felt apron below it (where the case's engraved plate sits). Portrait,
    2.0 wide x FELT_H tall in scene units; the well (r 0.80) is centred at the
    origin, i.e. 1.0 / FELT_H of the way down the tile."""
    G = 700
    xs = np.linspace(-1, 1, G)
    ys = np.linspace(1.0 - FELT_H, 1.0, int(G * FELT_H / 2))
    X, Y = np.meshgrid(xs, ys)
    Rr = np.hypot(X, Y)
    WELL = 0.80      # well radius (coin is 0.76 of the half-tile)
    DEPTH = 0.17
    lip = np.clip((Rr - (WELL - 0.03)) / 0.05, 0, 1)
    lip = lip * lip * (3 - 2 * lip)
    Z = -DEPTH * (1 - lip)
    # the floor dishes very slightly (felt pressed in by years of a coin)
    Z -= 0.01 * (1 - np.clip(Rr / WELL, 0, 1) ** 2) * (Rr < WELL)
    # padded rim swell just outside the well, like felt stretched over a cut-out
    Z += 0.018 * np.exp(-((Rr - WELL - 0.035) / 0.04) ** 2)
    V = np.stack([X, Y, Z], -1).reshape(-1, 3).astype(np.float32)
    idx = np.arange(X.size).reshape(X.shape)
    a, b = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel()
    c, d = idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
    Q = np.stack([a, b, c, d], -1)
    me = bpy.data.meshes.new("felt")
    me.vertices.add(len(V))
    me.vertices.foreach_set("co", V.ravel())
    me.loops.add(Q.size)
    me.loops.foreach_set("vertex_index", Q.ravel().astype(np.int32))
    me.polygons.add(len(Q))
    me.polygons.foreach_set("loop_start", (np.arange(len(Q)) * 4).astype(np.int32))
    me.update(calc_edges=True)
    try:
        me.shade_smooth()
    except Exception:
        pass
    ob = bpy.data.objects.new("Felt", me)
    scene.collection.objects.link(ob)

    m = bpy.data.materials.new("felt")
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    col = tuple(float(c) for c in args.felt_color.split(","))
    p.inputs["Roughness"].default_value = 0.95
    p.inputs["Sheen Weight"].default_value = 1.0
    p.inputs["Sheen Roughness"].default_value = 0.35
    p.inputs["Sheen Tint"].default_value = (min(1, col[0] * 9), min(1, col[1] * 9), min(1, col[2] * 9), 1)
    p.inputs["Specular IOR Level"].default_value = 0.1
    # fibre texture: two scales of noise + a fine directional streak
    tc = node(nt, "ShaderNodeTexCoord")
    n1 = node(nt, "ShaderNodeTexNoise")
    n1.inputs["Scale"].default_value = 300.0
    n1.inputs["Detail"].default_value = 8.0
    n1.inputs["Roughness"].default_value = 0.7
    nt.links.new(tc.outputs["Object"], n1.inputs["Vector"])
    n2 = node(nt, "ShaderNodeTexNoise")
    n2.inputs["Scale"].default_value = 40.0
    n2.inputs["Detail"].default_value = 3.0
    nt.links.new(tc.outputs["Object"], n2.inputs["Vector"])
    mix = node(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["A"].default_value = (*col, 1)
    rmp = node(nt, "ShaderNodeMapRange")
    rmp.inputs["From Min"].default_value = 0.3
    rmp.inputs["From Max"].default_value = 0.7
    rmp.inputs["To Min"].default_value = 0.80
    rmp.inputs["To Max"].default_value = 1.20
    nt.links.new(n2.outputs["Fac"], rmp.inputs["Value"])
    # per-fibre tone: fine noise modulates the dye so the pile reads as fibres
    n3 = node(nt, "ShaderNodeTexNoise")
    n3.inputs["Scale"].default_value = 650.0
    n3.inputs["Detail"].default_value = 12.0
    n3.inputs["Roughness"].default_value = 0.8
    n3.inputs["Distortion"].default_value = 0.6
    nt.links.new(tc.outputs["Object"], n3.inputs["Vector"])
    r3 = node(nt, "ShaderNodeMapRange")
    r3.inputs["From Min"].default_value = 0.3
    r3.inputs["From Max"].default_value = 0.7
    r3.inputs["To Min"].default_value = 0.7
    r3.inputs["To Max"].default_value = 1.3
    nt.links.new(n3.outputs["Fac"], r3.inputs["Value"])
    tone = node(nt, "ShaderNodeMath", operation="MULTIPLY")
    nt.links.new(rmp.outputs["Result"], tone.inputs[0])
    nt.links.new(r3.outputs["Result"], tone.inputs[1])
    nt.links.new(tone.outputs["Value"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], p.inputs["Base Color"])
    bmp = node(nt, "ShaderNodeBump")
    bmp.inputs["Strength"].default_value = 0.9
    bmp.inputs["Distance"].default_value = 0.006
    nt.links.new(n1.outputs["Fac"], bmp.inputs["Height"])
    nt.links.new(bmp.outputs["Normal"], p.inputs["Normal"])
    ob.data.materials.append(m)

    world(0.05)
    # soft key from the top (case lid side) — the well's upper lip shades its interior
    area("key", (-0.5, 3.6, 2.0), (0, 0, 0), 2.0, 300)
    area("fill", (2.5, -2.0, 2.5), (0, 0, 0), 3.0, 40, (0.9, 0.95, 1.0))
    area("top", (0, 0, 4), (0, 0, 0), 4.0, 60)
    scene.render.film_transparent = False
    # no denoiser: it would iron the fibre grain flat; felt is cheap to sample
    cy.use_denoising = False
    cy.samples = max(args.samples, 384)
    scene.render.resolution_y = round(args.res * FELT_H / 2.0)
    mid = 1.0 - FELT_H / 2
    camera(True, (0, mid, 5), (0, mid, 0), scale=FELT_H)


def sparkle_lights():
    """Small hot sources that ONLY the gems see (light linking): what makes a cut
    stone fire, without spotting the mirror field or enamel."""
    gems = gem_collection()
    lights = []
    for k in range(9):
        a = 2 * math.pi * k / 9 + 0.3
        lights.append(area(f"spark{k}", (1.8 * math.cos(a), 1.8 * math.sin(a), 2.4), (0, 0, 0), 0.08, 320))
    for ob in list(gems.objects):
        x, y, _ = ob.location
        # a crown of near-overhead sources: the angles a brilliant returns to the eye
        for k in range(6):
            a = 2 * math.pi * k / 6 + 0.4
            lights.append(area(f"crown-{ob.name}-{k}", (x + 0.55 * math.cos(a), y + 0.55 * math.sin(a), 1.6),
                               (x, y, 0), 0.10, 70))
        lights.append(area(f"table-{ob.name}", (x - 0.10, y + 0.16, 1.8), (x, y, 0), 0.22, 7))
    for l in lights:
        try:
            l.light_linking.receiver_collection = gems
        except AttributeError:
            pass


# ── main ─────────────────────────────────────────────────────────────────────
if args.mode == "felt":
    felt_tile()
else:
    coin = build_coin(args.height)
    coin.data.materials.append(coin_material(args.mask, args.tier))
    top_z = T / 2 + 0.86 * RELIEF
    if args.gems:
        for ang in (0.0, math.pi):
            gem("gem", (0.7935 * math.cos(ang), 0.7935 * math.sin(ang), T / 2 + 0.30 * RELIEF), 0.050)

    world(0.35)
    if args.mode == "face":
        # overhead softbox reflected 1:1 by the flat polished tops
        emission_plane("softbox", 7.0, (0, 0, 3.0), (math.pi, 0, 0), 2.4)
        area("key", (-3.2, 3.2, 2.4), (0, 0, 0), 2.4, 900, (1.0, 0.96, 0.90))
        area("rim", (3.6, -1.2, 1.2), (0, 0, 0), 1.5, 260, (0.85, 0.92, 1.0))
        area("kick", (1.5, 3.8, 1.0), (0, 0, 0), 1.0, 160)
        if args.gems:
            sparkle_lights()
        camera(True, (0, 0, 6), (0, 0, 0), scale=2.0 * R * 1.004)
    else:
        coin.rotation_euler = (math.radians(40), 0, math.radians(-24))
        coin.location = (0, 0, 0)
        emission_plane("softbox", 8.0, (0, 2.0, 4.0), (math.radians(160), 0, 0), 1.6)
        area("key", (-3.0, -2.5, 3.0), (0, 0, 0), 2.5, 520, (1.0, 0.97, 0.92))
        area("rim", (3.2, 2.5, 1.0), (0, 0, 0), 1.5, 380, (0.85, 0.92, 1.0))
        area("under", (0.0, -3.0, -1.6), (0, 0, 0), 2.0, 120)
        cam = camera(False, (0, -9.0, 1.6), (0, 0, 0), lens=110)
        # parent gems to the coin so they tilt with it
        for ob in scene.objects:
            if ob.name.startswith("gem"):
                ob.parent = coin
        if args.gems:
            sparkle_lights()

scene.render.filepath = args.out
bpy.ops.render.render(write_still=True)
print("RENDERED", args.out)
