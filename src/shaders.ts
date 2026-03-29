export const Shaders = () => {
    const vertex = `
        struct Uniforms {
            mvpMatrix   : mat4x4<f32>,
            modelMatrix : mat4x4<f32>,
        };
        @binding(0) @group(0) var<uniform> uniforms : Uniforms;

        struct Output {
            @builtin(position) Position : vec4<f32>,
            @location(0) worldPos    : vec3<f32>,
            @location(1) worldNormal : vec3<f32>,
        };

        @vertex
        fn vs_main(@location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>) -> Output {
            var out: Output;
            out.Position    = uniforms.mvpMatrix * vec4<f32>(pos, 1.0);
            out.worldPos    = (uniforms.modelMatrix * vec4<f32>(pos, 1.0)).xyz;
            out.worldNormal = normalize((uniforms.modelMatrix * vec4<f32>(normal, 0.0)).xyz);
            return out;
        }`;

    const fragment = `
        @fragment
        fn fs_main(@location(0) worldPos: vec3<f32>, @location(1) worldNormal: vec3<f32>) -> @location(0) vec4<f32> {
            let N = normalize(worldNormal);
            let V = normalize(vec3<f32>(2.0, 2.0, 4.0) - worldPos);

            // Gold key light from top-right, purple fill from opposite side
            let L1 = normalize(vec3<f32>(3.0, 4.0, 5.0));
            let L2 = normalize(vec3<f32>(-2.0, 0.5, -2.0));

            let H1 = normalize(V + L1);
            let H2 = normalize(V + L2);

            let spec1 = pow(max(dot(N, H1), 0.0), 90.0);
            let spec2 = pow(max(dot(N, H2), 0.0), 40.0);
            let diff1 = max(dot(N, L1), 0.0);

            // Fresnel edge glow
            let fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);

            let gold   = vec3<f32>(1.0, 0.78, 0.18);
            let purple = vec3<f32>(0.52, 0.08, 0.92);

            var color = vec3<f32>(0.04, 0.02, 0.06);           // near-black ambient
            color += diff1 * 0.12 * mix(gold, purple, 0.4);    // subtle diffuse
            color += spec1 * gold;                              // gold specular
            color += spec2 * 0.7 * purple;                     // purple specular
            color += fresnel * 0.5 * mix(gold, purple, 0.5);   // edge glow

            return vec4<f32>(color, 1.0);
        }`;

    return { vertex, fragment };
};
