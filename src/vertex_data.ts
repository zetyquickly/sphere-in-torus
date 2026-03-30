import { vec3 } from 'gl-matrix';
import { SpherePosition, TorusPosition } from './math-func';


// Solid sphere with UV coordinates for texture mapping — [x, y, z, u, v] per vertex, stride 20
export const SphereSolidData = (radius: number, uCount: number, vCount: number, center: vec3 = [0, 0, 0]) => {
    if (uCount < 2 || vCount < 2) return;
    const pts: { pos: vec3, u: number, v: number }[][] = [];
    for (let i = 0; i <= uCount; i++) {
        const row: { pos: vec3, u: number, v: number }[] = [];
        for (let j = 0; j <= vCount; j++) {
            const pos = SpherePosition(radius, i * 180 / uCount, j * 360 / vCount, center);
            row.push({ pos, u: j / vCount, v: i / uCount });
        }
        pts.push(row);
    }
    const pp: number[] = [];
    for (let i = 0; i < uCount; i++) {
        for (let j = 0; j < vCount; j++) {
            const p00 = pts[i][j], p10 = pts[i+1][j], p01 = pts[i][j+1], p11 = pts[i+1][j+1];
            pp.push(p00.pos[0], p00.pos[1], p00.pos[2], p00.u, p00.v);
            pp.push(p10.pos[0], p10.pos[1], p10.pos[2], p10.u, p10.v);
            pp.push(p11.pos[0], p11.pos[1], p11.pos[2], p11.u, p11.v);
            pp.push(p00.pos[0], p00.pos[1], p00.pos[2], p00.u, p00.v);
            pp.push(p11.pos[0], p11.pos[1], p11.pos[2], p11.u, p11.v);
            pp.push(p01.pos[0], p01.pos[1], p01.pos[2], p01.u, p01.v);
        }
    }
    return new Float32Array(pp);
};

// Tube mesh for each torus wireframe edge — [x, y, z, nx, ny, nz] per vertex, stride 24, triangle-list
export const TorusTubeData = (R: number, r: number, N: number, n: number, tubeR: number = 0.025, nsides: number = 6): Float32Array => {
    const pts: vec3[][] = [];
    for (let i = 0; i < N; i++) {
        const row: vec3[] = [];
        for (let j = 0; j < n; j++) {
            row.push(TorusPosition(R, r, i * 360 / N, j * 360 / n));
        }
        pts.push(row);
    }

    const verts: number[] = [];

    const addTube = (A: vec3, B: vec3) => {
        const dir = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), B, A));
        const ref: vec3 = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const perp1 = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), dir, ref));
        const perp2 = vec3.cross(vec3.create(), dir, perp1);

        for (let s = 0; s < nsides; s++) {
            const a0 = (s / nsides) * 2 * Math.PI;
            const a1 = ((s + 1) / nsides) * 2 * Math.PI;
            const nx0 = Math.cos(a0), ny0 = Math.sin(a0);
            const nx1 = Math.cos(a1), ny1 = Math.sin(a1);

            const n0: vec3 = [perp1[0]*nx0 + perp2[0]*ny0, perp1[1]*nx0 + perp2[1]*ny0, perp1[2]*nx0 + perp2[2]*ny0];
            const n1: vec3 = [perp1[0]*nx1 + perp2[0]*ny1, perp1[1]*nx1 + perp2[1]*ny1, perp1[2]*nx1 + perp2[2]*ny1];

            const pA0: vec3 = [A[0] + n0[0]*tubeR, A[1] + n0[1]*tubeR, A[2] + n0[2]*tubeR];
            const pA1: vec3 = [A[0] + n1[0]*tubeR, A[1] + n1[1]*tubeR, A[2] + n1[2]*tubeR];
            const pB0: vec3 = [B[0] + n0[0]*tubeR, B[1] + n0[1]*tubeR, B[2] + n0[2]*tubeR];
            const pB1: vec3 = [B[0] + n1[0]*tubeR, B[1] + n1[1]*tubeR, B[2] + n1[2]*tubeR];

            verts.push(pA0[0], pA0[1], pA0[2], n0[0], n0[1], n0[2]);
            verts.push(pB0[0], pB0[1], pB0[2], n0[0], n0[1], n0[2]);
            verts.push(pB1[0], pB1[1], pB1[2], n1[0], n1[1], n1[2]);

            verts.push(pA0[0], pA0[1], pA0[2], n0[0], n0[1], n0[2]);
            verts.push(pB1[0], pB1[1], pB1[2], n1[0], n1[1], n1[2]);
            verts.push(pA1[0], pA1[1], pA1[2], n1[0], n1[1], n1[2]);
        }
    };

    for (let i = 0; i < N; i++)
        for (let j = 0; j < n; j++)
            addTube(pts[i][j], pts[(i + 1) % N][j]);

    for (let i = 0; i < N; i++)
        for (let j = 0; j < n; j++)
            addTube(pts[i][j], pts[i][(j + 1) % n]);

    return new Float32Array(verts);
};

