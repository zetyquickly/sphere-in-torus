# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A WebGPU graphics demo that renders an animated green wireframe sphere orbiting inside a red wireframe torus. Both objects rotate together in 3D.

## Commands

```bash
# Install dependencies
npm install

# Build for development
npm run dev

# Build for production
npm run prod

# Watch mode (rebuild on changes)
npm run watch

# Type-check only
npm run tsc
```

The built output goes to `dist/`. Open `dist/index.html` in a WebGPU-capable browser (Chrome with WebGPU support) to run the app.

## Architecture

### Entry point
`src/main.ts` — initializes WebGPU, creates geometry buffers, sets up the render pipeline, and runs the animation loop.

### Key data flow
1. **Geometry** is generated in `src/vertex_data.ts` using parametric math from `src/math-func.ts`. Each vertex is 6 floats: `[x, y, z, r, g, b]` (stride = 24 bytes).
2. **Two objects share one uniform buffer** with a 256-byte offset between them. Each object gets its own bind group pointing to its slice of the buffer.
3. **Per-frame**: rotation angles increment, MVP matrices are recomputed for torus and sphere separately, written to the uniform buffer, then both are drawn with `line-list` topology (wireframe).
4. **Sphere tracking**: the sphere's position is derived from the torus's rotation matrix each frame — it orbits the torus tube center at radius `R` (major radius), inheriting the torus rotation via quaternion extraction.

### Source files
- `src/main.ts` — render loop, pipeline setup, object transforms
- `src/helper.ts` — WebGPU init (`InitGPU`), buffer creation helpers, camera/view/projection setup, animation loop (`CreateAnimation`)
- `src/vertex_data.ts` — `TorusWireframeData` and `SphereWireframeData` generators
- `src/math-func.ts` — parametric 3D position functions: `TorusPosition`, `SpherePosition`, `CylinderPosition`, `ConePosition`
- `src/shaders.ts` — WGSL shaders as inline TypeScript strings (vertex + fragment)
- `src/shader.wgsl` — standalone WGSL file (same shader logic; loaded via `ts-shader-loader` if imported directly)

### Torus parameters (in `main.ts`)
- `R = 2` — major radius (center of tube to center of torus)
- `r = 0.5` — minor radius (tube radius)
- `N = 20, n = 20` — tessellation segments
- `sphereRadius = r * 0.8` — sphere fits inside the tube

### Build
Webpack bundles TypeScript (`ts-loader`) and WGSL shaders (`ts-shader-loader`) into `dist/main.bundle.js`. No separate dev server — open the HTML file directly.
