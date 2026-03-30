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
        @binding(1) @group(0) var envTex: texture_2d<f32>;
        @binding(2) @group(0) var envSampler: sampler;

        @fragment
        fn fs_main(@location(0) worldPos: vec3<f32>, @location(1) worldNormal: vec3<f32>) -> @location(0) vec4<f32> {
            let N = normalize(worldNormal);
            let V = normalize(vec3<f32>(2.0, 2.0, 4.0) - worldPos);
            let R = reflect(-V, N);

            // Environment reflection (equirect-ish mapping)
            let eu = atan2(R.z, R.x) * 0.15915494 + 0.5;
            let ev = asin(clamp(R.y, -1.0, 1.0)) * 0.31830989 + 0.5;
            let envUV = vec2<f32>(eu, 1.0 - ev);
            var envColor = textureSample(envTex, envSampler, envUV).rgb * 0.5;
            let envCenter = envUV - 0.5;
            let envVignette = 1.0 - smoothstep(0.4, 1.0, length(envCenter) * 1.2);
            envColor *= envVignette;

            // Gold key light from top-right, purple fill from opposite side
            let L1 = normalize(vec3<f32>(3.0, 4.0, 5.0));
            let L2 = normalize(vec3<f32>(-2.0, 0.5, -2.0));

            let H1 = normalize(V + L1);
            let H2 = normalize(V + L2);

            let spec1 = pow(max(dot(N, H1), 0.0), 90.0);
            let spec2 = pow(max(dot(N, H2), 0.0), 40.0);
            let diff1 = max(dot(N, L1), 0.0);

            // Fresnel-Schlick (F0 for gold ≈ 0.9)
            let F0 = vec3<f32>(0.9, 0.7, 0.3);
            let fresnel = F0 + (1.0 - F0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);

            let gold   = vec3<f32>(1.0, 0.78, 0.18);
            let purple = vec3<f32>(0.85, 0.016, 0.365);

            var color = vec3<f32>(0.04, 0.02, 0.06);           // near-black ambient
            color += diff1 * 0.12 * mix(gold, purple, 0.4);    // subtle diffuse
            color += spec1 * gold;                              // gold specular
            color += spec2 * 0.7 * purple;                     // purple specular
            color += fresnel * envColor * 0.6;                  // environment reflection
            color += fresnel * 0.15 * mix(gold, purple, 0.5);  // tinted edge glow

            return vec4<f32>(color, 1.0);
        }`;

    return { vertex, fragment };
};
