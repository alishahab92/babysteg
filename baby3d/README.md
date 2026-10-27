# Realistic 3D baby – owner guide

The app shows a short, calm turntable of the baby for the current week, above or instead of the drawing. Clips live here on the Pages site (`https://alishahab92.github.io/babysteg/baby3d/`), are listed in `manifest.json`, and a phone downloads one only when its card is on screen. With an empty manifest (`{"v":1,"weeks":[]}`) the feature shows nothing and the drawing stays.

**Nothing here is live until you upload it.** The clips go public only when you copy `site/baby3d` to the GitHub Pages repo and push (section 4). Before that, a **midwife or obstetrician should look at every clip** (section 5).

## 1. What the clips are

Babysteg's own model, built procedurally – no licensed or downloaded 3D assets, so no licence terms to check. Credit line under every clip: «3D: Babysteg – egen modell, illustrasjon» (`credits.json` next to the models; the app shows it under «Uke X · illustrasjon basert på gjennomsnitt»).

- **Coverage:** every second week, 12, 14 … 40 (15 clips). The app uses the nearest *earlier* clip up to 2 weeks back, so every week from 12 to 42 has a clip (odd weeks say «(nærmeste)»). Weeks 4–11 show the drawing: the week 8 and 10 renders were dropped in 1.16 – the embryo looked too finished at 8, and the normal gut bulge at 10 can worry people. They can be made again with `--weeks 8-11`.
- **Format:** 540×540, 6 s seamless loop (one slow turn), 24 fps (12 rendered + 12 interpolated per second), H.264 High, yuv420p, faststart, no audio, 300–900 KB each, on the app background `#1E1517`. Poster `weekNN.jpg` = frame 1, a three-quarter view of the face.
- **What the model shows:** C-curved embryo with hand plates and finger rays at 8, webbed fingers at 9, free fingers from 10–11 and toes a week later; head ≈ 0.45 of the crown–rump length at 8–12, ≈ 0.25–0.29 of the length from 16 on (sized to the biparietal diameter for the week); eyes move from the sides of the head to the front (8→12) and ears rise from the jaw to eye level; thin, rosy, translucent skin early, more opaque with fat padding after ~30 weeks (body thickness calibrated to average weight for the length); umbilical cord fading into the background. Eyes are closed in every week (calm). Legs drawn up and crossed so the genital region can't be seen – nothing is modelled there, the model is sex-neutral. No womb, no blood. Sizes are not to scale between weeks: each clip frames the baby.
- **Not modelled:** lanugo, vernix, hair, eyebrows, nails, skin creases; eyes stay closed after 26–28 weeks although real eyes open then. Faces are an average, not a portrait.

## 2. Re-make the clips

All in your home folder, no admin rights. Blender as a Python module from PyPI plus scikit-image (marching cubes); ffmpeg with ffprobe (static build in `~/bin` is fine). bpy 5.x needs Python 3.13:

```bash
uv venv ~/baby3d/venv --python 3.13 && uv pip install --python ~/baby3d/venv bpy scikit-image
PY=~/baby3d/venv/bin/python
```

**a) Models** (≈ 20 s per week, ~6 min for 17):

```bash
$PY scripts/baby3d/make_fetus.py --out ~/baby3d/models --only 8,10,12,14,16,18,20,22,24,26,28,30,32,34,36,38,40
```

Writes `~/baby3d/models/weekNN.blend` (mesh, skin and cord materials), `credits.json` and an empty `adjust.json`. It prints per week the girth and head calibration and the head width against the reference biparietal diameter – a quick sanity check. Options: `--weeks 8-40` (every week), `--res 340` (mesh detail), `--glb` (also a `.glb` for other 3D viewers; the cord fade doesn't survive glTF).

How it works, briefly (details in the header of `make_fetus.py`): one table of proportions per keyframe week (`KEYS`: head, trunk, limb lengths, finger/toe separation, face maturity, fat, skin translucency), interpolated for the weeks in between. A posed skeleton (curved spine, flexed head, limbs placed in the body frame, hands aimed at the cheek and chest with two-bone IK) carries soft "signed distance" shapes – ellipsoids and tapered capsules – that are blended into one smooth skin and meshed (marching cubes, Taubin smoothing). Two calibrations per week: the head is scaled to the biparietal diameter (+6 % for scalp), the body thickness so the volume matches the average weight for its length (fetal.ts weights at 8–12, a smooth weight-for-length curve from 13). Size comes from the lengths in `src/content/fetal.ts`, so skin translucency (subsurface scattering in millimetres) behaves physically: early weeks glow, late ones don't. To change the look, edit `KEYS`, `SKIN` or `FACE0/FACE1` and re-run.

**b) Render** (Cycles on the CPU; the published clips: ≈ 6.5 s per frame on 2 cores, ≈ 8 min per week, ≈ 2.3 h for 17):

```bash
$PY scripts/baby3d/render_turntable.py --in ~/baby3d/models --engine cycles --size 540 --samples 16 \
    --fps 12 --seconds 6 --look "Medium High Contrast" --fill 0.25
```

Frames land in `~/baby3d/models/_frames/weekNN/` (RGBA, transparent). Check models first with `--frames 1` (poster only, ~10 s per week) and look at `frame_0001.png`. With a GPU or a faster machine, `--size 720 --fps 24 --seconds 6` renders every frame (then encode with `FPS=24`). Camera tweaks per week go in `adjust.json` (`{"week20": {"start": 20, "elev": 6, "fill": 0.8}}` – see the script header), re-render one week with `--only 20 --force`.

**c) Encode and write the manifest:**

```bash
FPS=12 OUT_FPS=24 bash scripts/baby3d/encode.sh ~/baby3d/models/_frames
```

Composites each week on `#1E1517` (same as `BABY3D_BG` in `src/screens/Baby3D.tsx`), interpolates 12 → 24 fps (motion-compensated, `INTERP=blend` or `dup` if you ever see smearing), writes `weekNN.mp4` (CRF from 28, adjusted to land at 300–900 KB) and `weekNN.jpg` here, then rebuilds `manifest.json` from the files present, with `?v=<hash>` so phones refetch a re-rendered clip. Half-rendered weeks are skipped. Only the manifest: `python3 scripts/baby3d/make_manifest.py --credits ~/baby3d/models/credits.json`.

**d) Check** with the app's own parser – every week 8–42 must get a clip, files and hashes must match:

```bash
npx tsx --tsconfig scripts/baby3d/tsconfig.json scripts/baby3d/check-manifest.ts
```

## 3. Licensed models instead (optional)

The same render and encode steps take licensed `weekNN.glb/.gltf/.fbx/.obj` models (`--material skin` replaces grey materials with a soft skin shader). Get it medically reviewed and check the licence in writing: commercial use in a free app with ads, rendered video on the public web and in the app, worldwide, perpetual, modification allowed, no per-download royalty, no "editorial only" or "medical education only" clause. Put the required credit in `credits.json`. Never commit the model files.

## 4. Publish

`site/` is the Pages repo (main README, section 5a). Commit `baby3d/*.mp4`, `*.jpg` and `manifest.json` there and push – the 17 clips are 5.5 MB (300–380 KB each). To take everything down, set `manifest.json` back to `{"v":1,"weeks":[]}` and push; phones stop showing clips within 24 h.

## 5. Review before publishing

Have a midwife, obstetrician or fetal-medicine doctor look at all 17 clips (the posters are a quick first pass) and note any week to drop or change. Things to ask about: proportions and body shape per week, the embryo at 8–10 weeks, hands and feet, the face, the cord. If the reviewer hesitates on weeks 8–11, delete `week08`/`week10` mp4+jpg and re-run `make_manifest.py` – the series then starts at week 12 and the drawing covers the earlier weeks. Write down who reviewed it and when (e.g. in `credits.json`: «3D: Babysteg – egen modell, illustrasjon · faglig gjennomgått av jordmor NN»).

## 6. Test in the app

1. Open `https://alishahab92.github.io/babysteg/baby3d/manifest.json` and one `weekNN.mp4` in a browser.
2. In the app (dev build – `expo-video` is native, so iOS and Android need a new prebuild/dev build), set the due date so the current week has a clip. Phones cache the manifest 24 h: reinstall or clear app data to see a new one at once.
3. Check: poster appears at once, then a seamless silent loop; music in another app keeps playing; the clip pauses when the app goes to the background; iOS *Reduce Motion* / Android *Remove animations* shows the poster with «Trykk for å se babyen snu seg»; «Skru av 3D» hides it; Pause mode and after-birth hide it; airplane mode shows the cached copy or nothing; web preview (`npx expo start --web`) plays inline.

## 7. Sensitivity

- Calm, not cute: slow turn, no sound, no zoom, dark warm background, eyes closed, no captions about what the baby "feels".
- Honest label under every clip: «Uke X · illustrasjon basert på gjennomsnitt» plus the credit. If the nearest clip is from an earlier week it says «(nærmeste)».
- One tap turns it off («Skru av 3D», sets `baby3d: false`). It's never shown in Pause mode – that is the mode for loss and hard weeks – or after birth.
- Early weeks look strange to many people; see section 5 for starting the series at week 12.
