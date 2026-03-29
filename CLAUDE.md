# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A WebGPU graphics demo of a green wireframe sphere bouncing with physics inside a red wireframe torus. The torus tumbles in 3D while the sphere moves freely inside the tube, colliding with the inner surface.

## Commands

```bash
npm install       # install dependencies
npm run dev       # build for development
npm run prod      # build for production
npm run watch     # rebuild on changes
npm run tsc       # type-check only
```

Serve `dist/` over HTTP (e.g. `python3 -m http.server 8080` inside `dist/`). Opening `dist/index.html` as a `file://` URL won't work — WebGPU requires an HTTP context. Chrome 113+ required.

## Architecture

### Entry point
`src/main.ts` — reads UI state, initializes WebGPU, creates geometry buffers, runs the physics + render loop.

### Per-frame data flow
1. Torus rotation matrix is updated (tumbling around a time-varying axis in the XY plane)
2. Sphere physics are integrated in the **torus local frame** (before torus rotation is applied)
3. Collision is detected and resolved
4. Sphere model matrix = `torusRotation * translation * sphereOrientation`
5. Both objects share one uniform buffer (256-byte aligned offsets), each with its own bind group

### Physics model
The sphere has four state variables:
- `spherePos` — position in torus local frame
- `sphereVel` — linear velocity
- `sphereOmega` — angular velocity (spin axis × rate)
- `sphereQuat` — orientation quaternion (integrated from `sphereOmega` each frame)

**Collision detection:** nearest point on torus central circle (XZ plane) → tube-radial normal `n`. Sphere is pushed back when `distTube > r - sphereRadius`.

**Collision response:**
- Normal impulse: `J_n = -(1+e) * (v·n)` — reflects normal velocity (e=1 hardcoded, perfectly elastic)
- Friction impulse: applied **to `ω` only, never to `v`** — this is key. Applying friction to `v` drains along-orbit velocity (since `n ⊥ t_orbit` always in torus geometry), causing the sphere to collapse into cross-sectional bouncing. Spin-only friction preserves all translational motion.

**Tangential nudge** (`eps`, currently 0): a small per-frame velocity bias along the orbit tangent to prevent the sphere from getting stuck bouncing in one cross-section. Disabled because non-zero eps causes the sphere to press against the outer wall via centrifugal drift.

### UI controls
All sliders live in `dist/index.html`. Controls that change geometry (R, r, sphere radius) call `Create3DObject(true)` to rebuild GPU buffers. Controls that only affect runtime behaviour (tumble speed, friction) are read live each frame via DOM element references captured in the closure.

| Slider | Effect | Restart? |
|---|---|---|
| Major radius R | Torus ring size | Yes |
| Tube radius r | Tube cross-section size | Yes |
| Sphere radius | Sphere size (must be < r) | Yes |
| Tumble speed | Rate of torus axis change per frame | No |
| Friction μ | Spin imparted per collision | No |

### Key geometric fact
`n ⊥ t_orbit` always — the tube-radial normal is always perpendicular to the orbit tangent. This means normal reflection never affects along-orbit velocity, and with friction applied to `ω` only, the sphere's orbital motion is fully conserved.

### Source files
- `src/main.ts` — physics, render loop, UI wiring
- `src/helper.ts` — WebGPU init, buffer helpers, `CreateAnimation` (accepts `getSpeed` callback for live tumble speed)
- `src/vertex_data.ts` — `TorusWireframeData`, `SphereWireframeData`
- `src/math-func.ts` — parametric position functions: `TorusPosition`, `SpherePosition`, `CylinderPosition`, `ConePosition`
- `src/shaders.ts` — WGSL vertex + fragment shaders as inline strings

### Build
Webpack bundles TypeScript (`ts-loader`) and WGSL (`ts-shader-loader`) into `dist/main.bundle.js`.
