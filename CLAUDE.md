# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A WebGPU graphics demo of two textured spheres (moon and earth) bouncing with rigid-body physics inside a metallic gold/crimson wireframe torus. The torus tumbles in 3D and can be spun by mouse drag. Both spheres orbit inside the tube, collide with the walls and with each other, and spin realistically.

## Commands

```bash
npm install       # install dependencies
npm run dev       # build for development
npm run prod      # build for production
npm run watch     # rebuild on changes
npm run tsc       # type-check only
```

Serve `dist/` over HTTP (e.g. `python3 -m http.server 8080` inside `dist/`). Opening `dist/index.html` as a `file://` URL won't work — WebGPU requires an HTTP context. Chrome 113+ required.

Two pages are available:
- `dist/index.html` — full UI with all sliders
- `dist/fullscreen.html` — canvas only, no controls (same bundle, hidden inputs with defaults)

## Architecture

### Entry point
`src/main.ts` — reads UI state, initializes WebGPU, creates geometry buffers, runs the physics + render loop.

### Per-frame data flow
1. Drag momentum applied to `dragAngle` (Y-axis orbit spin)
2. Torus tumble rotation matrix updated (time-varying axis in XY plane)
3. `torusRotationMatrix` extracted from tumble only (no drag) — this is the physics frame
4. Drag Y-rotation applied on top for the torus visual only
5. Both sphere physics integrated N times (`sim steps/frame`) in the torus local frame
6. Sphere model matrix = `torusRotationMatrix * translation * sphereOrientation`
7. Torus uses shared `uniformBuffer`; each sphere has its own uniform buffer + bind group

### Rendering pipelines
Three pipelines, drawn in order:

1. **Skybox** — fullscreen triangle (no vertex buffer), samples `assets/skybox3.jpg` via center-crop UV, drawn at depth 1.0 before all geometry
2. **Torus** — `triangle-list` topology, stride 24 (`float32x3` pos + `float32x3` normal), WGSL shaders from `src/shaders.ts`, samples skybox as environment map
3. **Sphere** — `triangle-list` topology, stride 20 (`float32x3` pos + `float32x2` UV), inline WGSL shaders in `main.ts`, samples surface texture + skybox env reflection

### Shader model (torus — `src/shaders.ts`)
Blinn-Phong + Fresnel-Schlick + environment reflection:
- Gold key light (`L1`) + crimson fill light (`L2`)
- Fresnel-Schlick with F0 = (0.9, 0.7, 0.3) for gold metal
- Environment reflection: reflection vector `R` → equirectangular UV → skybox sample (dimmed 0.5 × vignette)
- Edge glow: `fresnel * 0.15 * mix(gold, crimson, 0.5)`

### Shader model (spheres — inline in `main.ts`)
Texture + Fresnel-Schlick environment reflection (additive):
- Normal computed as `normalize(localPos)` (sphere geometry)
- Fresnel F0 = 0.04 (non-metallic)
- Env reflection added on top of albedo: `albedo + fresnel * envColor * 2.0`
- Both moon and earth share the same shader; bind group swaps the surface texture

### Physics model
Each sphere has four state variables:
- `spherePos` — position in torus local frame
- `sphereVel` — linear velocity
- `sphereOmega` — angular velocity (spin axis × rate), clamped to 6 rad/s
- `sphereQuat` — orientation quaternion (integrated from `sphereOmega` each sub-step)

**Two spheres:**
- Moon (sphere 1): radius = `sphere2Radius * 0.4`, mass = 1, starts at `(R, 0, 0)`
- Earth (sphere 2): radius = `sphere2Radius` (slider), mass = 3, starts 30° ahead on the ring

**Initial velocity:** random unit vector within a 15° cone around the orbit tangent `(0, 0, -1)`, scaled to `sphereSpeed = 1.5`. Both spheres share the same initial direction.

**Collision detection:** nearest point on torus central circle (XZ plane) → tube-radial normal `n`. Sphere pushed back when `distTube > r - sphereRadius`.

**Collision response (sphere–wall):**
- Normal impulse: `J_n = -(1+e) * (v·n)` — reflects normal velocity (e=1, perfectly elastic)
- Friction impulse: applied **to `ω` only, never to `v`** — preserves along-orbit velocity since `n ⊥ t_orbit` always

**Sphere–sphere collision:** elastic with mass ratio m1=1, m2=3. Push-apart + impulse exchange proportional to masses.

**Orbital floor:** minimum orbital speed 0.3 enforced each sub-step to prevent stalling.

**Angular speed clamp:** `sphereOmega` clamped to 6 rad/s after each response.

### Mouse drag interaction
- Drag horizontally on canvas → accumulates `dragAngle` (Y-axis rotation)
- On release → `dragSpeed = lastDragDx * dragSensitivity`, decays with `dragDamping = 0.98`
- Applied to torus visual only via `mat4.fromYRotation(dragMat, dragAngle)`
- Spheres are unaffected — they use `torusRotationMatrix` (tumble only)

### UI controls
All sliders live in `dist/index.html`. Controls that change geometry call `Create3DObject(true)` to rebuild GPU buffers.

| Slider | Effect | Restart? |
|---|---|---|
| Major radius R | Torus ring size | Yes |
| Tube radius r | Tube cross-section size | Yes |
| Sphere radius | Earth sphere size (moon = 0.4×) | Yes |
| Tumble speed | Rate of torus axis change per frame | No |
| Sim steps/frame | Physics sub-steps per render frame (1–50) | No |
| Friction μ | Spin imparted per wall collision | No |
| MSAA 4x | Toggle anti-aliasing (rebuilds pipeline) | Yes |
| Render scale | Canvas resolution multiplier (0.5–2×) | Yes |

Realtime **v** and **ω** of the moon sphere displayed below sliders.

### Key geometric fact
`n ⊥ t_orbit` always — the tube-radial normal is always perpendicular to the orbit tangent. Normal reflection never affects along-orbit velocity; with friction on `ω` only, orbital motion is fully conserved.

### Source files
- `src/main.ts` — physics, render loop, UI wiring, inline sphere shaders
- `src/helper.ts` — WebGPU init, buffer helpers, `CreateAnimation`
- `src/vertex_data.ts` — `TorusTubeData` (solid tube, stride 24), `SphereSolidData` (UV sphere, stride 20)
- `src/math-func.ts` — parametric position functions
- `src/shaders.ts` — WGSL vertex + fragment shaders for the torus pipeline
- `assets/lroc_color_2k.jpg` — moon texture
- `assets/2k_earth_daymap.jpg` — earth texture
- `assets/skybox3.jpg` — skybox/environment map (served from `dist/assets/`)

### Build
Webpack bundles TypeScript (`ts-loader`) and WGSL (`ts-shader-loader`) into `dist/main.bundle.js`.
