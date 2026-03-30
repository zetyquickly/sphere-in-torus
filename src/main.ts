import { InitGPU, CreateGPUBuffer, CreateGPUBufferUint, CreateTransforms, CreateViewProjection, CreateAnimation } from './helper';
import { Shaders } from './shaders';
import { vec3, mat4, quat } from 'gl-matrix';
import { TorusTubeData, SphereSolidData } from './vertex_data';
import "./site.css";

// --- DOM elements (queried once) ---
const majorRadiusInput  = document.getElementById('major-radius') as HTMLInputElement;
const majorRadiusVal    = document.getElementById('major-radius-val') as HTMLSpanElement;
const tubeRadiusInput   = document.getElementById('tube-radius') as HTMLInputElement;
const tubeRadiusVal     = document.getElementById('tube-radius-val') as HTMLSpanElement;
const sphereRadiusInput = document.getElementById('sphere-radius') as HTMLInputElement;
const sphereRadiusVal   = document.getElementById('sphere-radius-val') as HTMLSpanElement;
const tumbleSpeedInput  = document.getElementById('tumble-speed') as HTMLInputElement;
const tumbleSpeedVal    = document.getElementById('tumble-speed-val') as HTMLSpanElement;
const frictionInput     = document.getElementById('friction') as HTMLInputElement;
const frictionVal       = document.getElementById('friction-val') as HTMLSpanElement;
const simStepsInput     = document.getElementById('sim-steps') as HTMLInputElement;
const simStepsVal       = document.getElementById('sim-steps-val') as HTMLSpanElement;
const msaaToggle        = document.getElementById('msaa-toggle') as HTMLInputElement;
const renderScaleInput  = document.getElementById('render-scale') as HTMLInputElement;
const renderScaleVal    = document.getElementById('render-scale-val') as HTMLSpanElement;
const velMagEl   = document.getElementById('vel-mag')!;
const velXEl     = document.getElementById('vel-x')!;
const velYEl     = document.getElementById('vel-y')!;
const velZEl     = document.getElementById('vel-z')!;
const omegaMagEl = document.getElementById('omega-mag')!;
const omegaXEl   = document.getElementById('omega-x')!;
const omegaYEl   = document.getElementById('omega-y')!;
const omegaZEl   = document.getElementById('omega-z')!;

// --- GPU resource tracking ---
let prevResources: { destroy(): void }[] = [];

const Create3DObject = async (isAnimation = true) => {
    // Destroy previous GPU resources
    for (const res of prevResources) res.destroy();
    prevResources = [];

    const gpu = await InitGPU();
    const device = gpu.device;

    let R = parseFloat(majorRadiusInput.value);
    let r = parseFloat(tubeRadiusInput.value);
    let N = 20, n = 10;
    const sphere2Radius = parseFloat(sphereRadiusInput.value);
    let sphereRadius = sphere2Radius * 0.33;
    const sampleCount = msaaToggle.checked ? 4 : 1;
    const torusTubeData = TorusTubeData(R, r, N, n, 0.025, 12);
    const sphereSolidData = SphereSolidData(sphereRadius, 40, 40) as Float32Array;
    const sphere2SolidData = SphereSolidData(sphere2Radius, 40, 40) as Float32Array;

    // Create vertex buffers
    const torusNumberOfVertices = torusTubeData.length / 6;
    const torusVertexBuffer = CreateGPUBuffer(device, torusTubeData);
    const sphereNumberOfVertices = sphereSolidData.length / 5;
    const sphereVertexBuffer = CreateGPUBuffer(device, sphereSolidData);
    const sphere2NumberOfVertices = sphere2SolidData.length / 5;
    const sphere2VertexBuffer = CreateGPUBuffer(device, sphere2SolidData);

    const shader = Shaders();
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({
                code: shader.vertex
            }),
            entryPoint: "vs_main",
            buffers: [
                {
                    arrayStride: 24,
                    attributes: [
                        {
                            shaderLocation: 0,
                            format: "float32x3",
                            offset: 0
                        },
                        {
                            shaderLocation: 1,
                            format: "float32x3",
                            offset: 12
                        }
                    ]
                }
            ]
        },
        fragment: {
            module: device.createShaderModule({
                code: shader.fragment
            }),
            entryPoint: "fs_main",
            targets: [
                {
                    format: gpu.format
                }
            ]
        },
        primitive: {
            topology: "triangle-list",
        },
        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less"
        },
        multisample: {
            count: sampleCount,
        }
    });

    // Load textures
    const [moonImage, earthImage] = await Promise.all([
        fetch('assets/lroc_color_2k.jpg').then(r => r.blob()).then(createImageBitmap),
        fetch('assets/2k_earth_daymap.jpg').then(r => r.blob()).then(createImageBitmap),
    ]);
    const moonTexture = device.createTexture({
        size: [moonImage.width, moonImage.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: moonImage }, { texture: moonTexture }, [moonImage.width, moonImage.height]);
    const earthTexture = device.createTexture({
        size: [earthImage.width, earthImage.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: earthImage }, { texture: earthTexture }, [earthImage.width, earthImage.height]);
    const texSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    // Sphere pipeline — triangle-list with texture
    const sphereVertexShader = `
        struct Uniforms { mvpMatrix: mat4x4<f32> };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        struct Output {
            @builtin(position) Position: vec4<f32>,
            @location(0) vUV: vec2<f32>,
        };
        @vertex fn vs_main(@location(0) pos: vec3<f32>, @location(1) uv: vec2<f32>) -> Output {
            var out: Output;
            out.Position = uniforms.mvpMatrix * vec4<f32>(pos, 1.0);
            out.vUV = uv;
            return out;
        }`;
    const sphereFragmentShader = `
        @group(0) @binding(1) var moonTex: texture_2d<f32>;
        @group(0) @binding(2) var texSampler: sampler;
        @fragment fn fs_main(@location(0) vUV: vec2<f32>) -> @location(0) vec4<f32> {
            return textureSample(moonTex, texSampler, vUV);
        }`;
    const spherePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: sphereVertexShader }),
            entryPoint: 'vs_main',
            buffers: [{ arrayStride: 20, attributes: [
                { shaderLocation: 0, format: 'float32x3', offset: 0 },
                { shaderLocation: 1, format: 'float32x2', offset: 12 },
            ]}]
        },
        fragment: {
            module: device.createShaderModule({ code: sphereFragmentShader }),
            entryPoint: 'fs_main',
            targets: [{ format: gpu.format }]
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
        multisample: { count: sampleCount }
    });

    // Create uniform data
    const matrixSize = 4 * 16;
    const uniformOffset = 256;
    const uniformBufferSize = uniformOffset + matrixSize;
    let rotation = vec3.fromValues(0, 0, 0);

    const vp = CreateViewProjection(gpu.canvas.width / gpu.canvas.height);
    const modelMatrix1 = mat4.create();
    const translateMatrix1 = mat4.create();
    CreateTransforms(translateMatrix1, [0, 0, 0], [0, 0, 0], [1, 1, 1]);
    const modelViewProjectionMatrix1 = mat4.create() as Float32Array;

    const modelMatrix2 = mat4.create();
    const modelViewProjectionMatrix2 = mat4.create() as Float32Array;
    const modelMatrix3 = mat4.create();
    const modelViewProjectionMatrix3 = mat4.create() as Float32Array;

    // Shared initial direction for both spheres
    const halfAngle = Math.PI / 6;
    const phi = Math.random() * 2 * Math.PI;
    const cosTheta = Math.cos(halfAngle) + Math.random() * (1 - Math.cos(halfAngle));
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    const initDir = vec3.fromValues(
        sinTheta * Math.cos(phi),
        sinTheta * Math.sin(phi),
        -cosTheta
    );

    // Physics state — sphere 1 (moon) lives in torus local frame
    const sphereSpeed = 1.5;
    const spherePos = vec3.fromValues(R, 0, 0);
    const sphereVel = vec3.scale(vec3.create(), initDir, sphereSpeed);
    const sphereOmega = vec3.create();
    const sphereQuat  = quat.create();

    // Track initial orbital direction so the propelling force never reverses it
    const dxz0 = Math.sqrt(spherePos[0] ** 2 + spherePos[2] ** 2);
    const t0 = vec3.fromValues(-spherePos[2] / dxz0, 0, spherePos[0] / dxz0);
    const orbitalDir = Math.sign(vec3.dot(sphereVel, t0)) || 1;

    // Physics state — sphere 2 (earth), starts after 2s delay
    const sphere2Pos = vec3.fromValues(R, 0, 0);
    const sphere2Vel = vec3.scale(vec3.create(), initDir, sphereSpeed);
    const sphere2Omega = vec3.create();
    const sphere2Quat  = quat.create();
    const sphere2OrbitalDir = orbitalDir;
    const sphere2Delay = 2.0; // seconds
    const startTime = performance.now();
    let sphere2Active = false;

    let lastTime = performance.now();

    // Create uniform buffer and layout
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const uniformBindGroup1 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: {
                buffer: uniformBuffer,
                offset: 0,
                size: matrixSize * 2   // mvpMatrix + modelMatrix
            }
        }]
    });

    const sphereUniformBuffer = device.createBuffer({
        size: matrixSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const sphereBindGroup = device.createBindGroup({
        layout: spherePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: sphereUniformBuffer } },
            { binding: 1, resource: moonTexture.createView() },
            { binding: 2, resource: texSampler },
        ]
    });

    const sphere2UniformBuffer = device.createBuffer({
        size: matrixSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const sphere2BindGroup = device.createBindGroup({
        layout: spherePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: sphere2UniformBuffer } },
            { binding: 1, resource: earthTexture.createView() },
            { binding: 2, resource: texSampler },
        ]
    });

    const msaaTexture = sampleCount > 1 ? device.createTexture({
        size: [gpu.canvas.width, gpu.canvas.height, 1],
        format: gpu.format,
        sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }) : null;
    const depthTexture = device.createTexture({
        size: [gpu.canvas.width, gpu.canvas.height, 1],
        format: "depth24plus",
        sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    const renderPassDescription = {
        colorAttachments: [{
            view: msaaTexture ? msaaTexture.createView() : gpu.context.getCurrentTexture().createView(),
            resolveTarget: msaaTexture ? gpu.context.getCurrentTexture().createView() : undefined,
            clearValue: { r: 0.2, g: 0.247, b: 0.314, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store'
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: "store",
        }
    };

    // Track GPU resources for cleanup on reinit
    prevResources = [torusVertexBuffer, sphereVertexBuffer, sphere2VertexBuffer, uniformBuffer, sphereUniformBuffer, sphere2UniformBuffer, depthTexture, moonTexture, earthTexture];
    if (msaaTexture) prevResources.push(msaaTexture);

    function draw() {

        // Transforms on the first object (torus)
        mat4.rotate(
            modelMatrix1,
            translateMatrix1,
            1,
            vec3.fromValues(Math.sin(2 * rotation[0]), Math.cos(2 * rotation[1]), 0)
        );
        mat4.multiply(modelViewProjectionMatrix1, vp.viewMatrix, modelMatrix1);
        mat4.multiply(modelViewProjectionMatrix1, vp.projectionMatrix, modelViewProjectionMatrix1);

       // Extract the rotation matrix from modelMatrix1
        const torusRotationQuat = quat.create();
        mat4.getRotation(torusRotationQuat, modelMatrix1);
        const torusRotationMatrix = mat4.create();
        mat4.fromQuat(torusRotationMatrix, torusRotationQuat);

        // Physics update
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        lastTime = now;

        const simSteps = parseInt(simStepsInput.value);
        const subDt = dt;
        for (let step = 0; step < simSteps; step++) {

        spherePos[0] += sphereVel[0] * subDt;
        spherePos[1] += sphereVel[1] * subDt;
        spherePos[2] += sphereVel[2] * subDt;

        // Nearest point on torus central circle (in XZ plane)
        const dxz = Math.sqrt(spherePos[0] ** 2 + spherePos[2] ** 2);
        const cx = dxz > 0 ? R * spherePos[0] / dxz : R;
        const cz = dxz > 0 ? R * spherePos[2] / dxz : 0;

        // Small tangential nudge aligned with current direction of travel (eps=0 to disable)
        const eps = 0;
        if (dxz > 0 && eps > 0) {
            const speed = vec3.length(sphereVel);
            const tx = -spherePos[2] / dxz;
            const tz =  spherePos[0] / dxz;
            const sign = sphereVel[0] * tx + sphereVel[2] * tz >= 0 ? 1 : -1;
            sphereVel[0] += sign * tx * eps;
            sphereVel[2] += sign * tz * eps;
            vec3.scale(sphereVel, sphereVel, speed / vec3.length(sphereVel));
        }

        // Vector from tube centerline to sphere center
        const nx = spherePos[0] - cx;
        const ny = spherePos[1];
        const nz = spherePos[2] - cz;
        const distTube = Math.sqrt(nx * nx + ny * ny + nz * nz);

        // Rigid body collision with inner tube surface
        const maxDist = r - sphereRadius;
        if (distTube > maxDist) {
            const inv = 1 / distTube;
            const n = vec3.fromValues(nx * inv, ny * inv, nz * inv);

            // Push sphere back to surface
            spherePos[0] = cx + n[0] * maxDist;
            spherePos[1] = n[1] * maxDist;
            spherePos[2] = cz + n[2] * maxDist;

            // r_c = sphereRadius * n (sphere center → contact point)
            const r_c = vec3.scale(vec3.create(), n, sphereRadius);

            // Contact velocity: v + ω × r_c
            const v_contact = vec3.add(vec3.create(), sphereVel,
                vec3.cross(vec3.create(), sphereOmega, r_c));

            // Normal component — positive means approaching wall
            const v_n = vec3.dot(v_contact, n);

            if (v_n > 0) {
                const e  = 1;
                const mu = parseFloat(frictionInput.value);

                // Normal impulse (unit mass, r_c ∥ n so no angular contribution)
                const J_n = -(1 + e) * v_n;
                vec3.scaleAndAdd(sphereVel, sphereVel, n, J_n);

                // Tangential contact velocity
                const v_t = vec3.scaleAndAdd(vec3.create(), v_contact, n, -v_n);
                const v_t_len = vec3.length(v_t);

                if (v_t_len > 1e-6) {
                    const t_hat = vec3.scale(vec3.create(), v_t, -1 / v_t_len);

                    // Friction impulse applied to ω only — v is unchanged
                    // preserves along-orbit velocity which is always ⊥ to n
                    const J_t = Math.min(v_t_len * 2 / 7, mu * Math.abs(J_n));
                    const I = 2 / 5 * sphereRadius * sphereRadius;
                    vec3.scaleAndAdd(sphereOmega, sphereOmega,
                        vec3.cross(vec3.create(), r_c, t_hat), J_t / I);
                }
            }
        }

        // Orbital floor: ensure sphere keeps moving around the torus in its original direction
        const v_min_orbital = 0.3;
        const dxzNow = Math.sqrt(spherePos[0] ** 2 + spherePos[2] ** 2);
        if (dxzNow > 0) {
            const t_orb = vec3.fromValues(-spherePos[2] / dxzNow, 0, spherePos[0] / dxzNow);
            const v_orb = vec3.dot(sphereVel, t_orb) * orbitalDir;
            if (v_orb < v_min_orbital) {
                vec3.scaleAndAdd(sphereVel, sphereVel, t_orb, orbitalDir * (v_min_orbital - v_orb));
            }
        }

        // Clamp angular speed
        const maxOmega = 6;
        const omegaSpeed = vec3.length(sphereOmega);
        if (omegaSpeed > maxOmega) vec3.scale(sphereOmega, sphereOmega, maxOmega / omegaSpeed);

        // Integrate angular velocity into orientation quaternion
        const omegaLen = vec3.length(sphereOmega);
        if (omegaLen > 1e-8) {
            const axis = vec3.scale(vec3.create(), sphereOmega, 1 / omegaLen);
            const dq = quat.setAxisAngle(quat.create(), axis, omegaLen * subDt);
            quat.multiply(sphereQuat, dq, sphereQuat);
            quat.normalize(sphereQuat, sphereQuat);
        }

        } // end sphere1 sim sub-steps loop

        // Activate sphere2 after delay
        if (!sphere2Active && (now - startTime) / 1000 >= sphere2Delay) {
            sphere2Active = true;
        }

        // Sphere 2 physics (identical logic, different radius)
        if (sphere2Active) {
        for (let step = 0; step < simSteps; step++) {

        sphere2Pos[0] += sphere2Vel[0] * subDt;
        sphere2Pos[1] += sphere2Vel[1] * subDt;
        sphere2Pos[2] += sphere2Vel[2] * subDt;

        const dxz2 = Math.sqrt(sphere2Pos[0] ** 2 + sphere2Pos[2] ** 2);
        const cx2 = dxz2 > 0 ? R * sphere2Pos[0] / dxz2 : R;
        const cz2 = dxz2 > 0 ? R * sphere2Pos[2] / dxz2 : 0;

        const nx2 = sphere2Pos[0] - cx2;
        const ny2 = sphere2Pos[1];
        const nz2 = sphere2Pos[2] - cz2;
        const distTube2 = Math.sqrt(nx2 * nx2 + ny2 * ny2 + nz2 * nz2);

        const maxDist2 = r - sphere2Radius;
        if (distTube2 > maxDist2) {
            const inv2 = 1 / distTube2;
            const n2 = vec3.fromValues(nx2 * inv2, ny2 * inv2, nz2 * inv2);

            sphere2Pos[0] = cx2 + n2[0] * maxDist2;
            sphere2Pos[1] = n2[1] * maxDist2;
            sphere2Pos[2] = cz2 + n2[2] * maxDist2;

            const r_c2 = vec3.scale(vec3.create(), n2, sphere2Radius);
            const v_contact2 = vec3.add(vec3.create(), sphere2Vel,
                vec3.cross(vec3.create(), sphere2Omega, r_c2));
            const v_n2 = vec3.dot(v_contact2, n2);

            if (v_n2 > 0) {
                const e2 = 1;
                const mu2 = parseFloat(frictionInput.value);
                const J_n2 = -(1 + e2) * v_n2;
                vec3.scaleAndAdd(sphere2Vel, sphere2Vel, n2, J_n2);

                const v_t2 = vec3.scaleAndAdd(vec3.create(), v_contact2, n2, -v_n2);
                const v_t_len2 = vec3.length(v_t2);
                if (v_t_len2 > 1e-6) {
                    const t_hat2 = vec3.scale(vec3.create(), v_t2, -1 / v_t_len2);
                    const J_t2 = Math.min(v_t_len2 * 2 / 7, mu2 * Math.abs(J_n2));
                    const I2 = 2 / 5 * sphere2Radius * sphere2Radius;
                    vec3.scaleAndAdd(sphere2Omega, sphere2Omega,
                        vec3.cross(vec3.create(), r_c2, t_hat2), J_t2 / I2);
                }
            }
        }

        // Orbital floor for sphere2
        const dxzNow2 = Math.sqrt(sphere2Pos[0] ** 2 + sphere2Pos[2] ** 2);
        if (dxzNow2 > 0) {
            const t_orb2 = vec3.fromValues(-sphere2Pos[2] / dxzNow2, 0, sphere2Pos[0] / dxzNow2);
            const v_orb2 = vec3.dot(sphere2Vel, t_orb2) * sphere2OrbitalDir;
            if (v_orb2 < 0.3) {
                vec3.scaleAndAdd(sphere2Vel, sphere2Vel, t_orb2, sphere2OrbitalDir * (0.3 - v_orb2));
            }
        }

        const maxOmega2 = 6;
        const omegaSpeed2 = vec3.length(sphere2Omega);
        if (omegaSpeed2 > maxOmega2) vec3.scale(sphere2Omega, sphere2Omega, maxOmega2 / omegaSpeed2);

        const omegaLen2 = vec3.length(sphere2Omega);
        if (omegaLen2 > 1e-8) {
            const axis2 = vec3.scale(vec3.create(), sphere2Omega, 1 / omegaLen2);
            const dq2 = quat.setAxisAngle(quat.create(), axis2, omegaLen2 * subDt);
            quat.multiply(sphere2Quat, dq2, sphere2Quat);
            quat.normalize(sphere2Quat, sphere2Quat);
        }

        } // end sphere2 sim sub-steps loop
        } // end sphere2Active check

        // Update realtime display
        const f = (x: number) => x.toFixed(3);
        velMagEl.textContent  = vec3.length(sphereVel).toFixed(3);
        velXEl.textContent    = f(sphereVel[0]);
        velYEl.textContent    = f(sphereVel[1]);
        velZEl.textContent    = f(sphereVel[2]);
        omegaMagEl.textContent = vec3.length(sphereOmega).toFixed(3);
        omegaXEl.textContent  = f(sphereOmega[0]);
        omegaYEl.textContent  = f(sphereOmega[1]);
        omegaZEl.textContent  = f(sphereOmega[2]);

        // Apply sphere position + orientation in torus local frame, then torus world rotation
        const sphereLocalMatrix = mat4.multiply(mat4.create(),
            mat4.fromTranslation(mat4.create(), spherePos),
            mat4.fromQuat(mat4.create(), sphereQuat));
        mat4.multiply(modelMatrix2, torusRotationMatrix, sphereLocalMatrix);
        mat4.multiply(modelViewProjectionMatrix2, vp.viewMatrix, modelMatrix2);
        mat4.multiply(modelViewProjectionMatrix2, vp.projectionMatrix, modelViewProjectionMatrix2);

        device.queue.writeBuffer(
            uniformBuffer,
            0,
            modelViewProjectionMatrix1.buffer,
            modelViewProjectionMatrix1.byteOffset,
            modelViewProjectionMatrix1.byteLength
        );
        device.queue.writeBuffer(uniformBuffer, matrixSize, (modelMatrix1 as any).buffer as ArrayBuffer, (modelMatrix1 as any).byteOffset, (modelMatrix1 as any).byteLength);

        device.queue.writeBuffer(
            sphereUniformBuffer, 0,
            modelViewProjectionMatrix2.buffer,
            modelViewProjectionMatrix2.byteOffset,
            modelViewProjectionMatrix2.byteLength
        );

        // Sphere 2 transform
        if (sphere2Active) {
            const sphere2LocalMatrix = mat4.multiply(mat4.create(),
                mat4.fromTranslation(mat4.create(), sphere2Pos),
                mat4.fromQuat(mat4.create(), sphere2Quat));
            mat4.multiply(modelMatrix3, torusRotationMatrix, sphere2LocalMatrix);
            mat4.multiply(modelViewProjectionMatrix3, vp.viewMatrix, modelMatrix3);
            mat4.multiply(modelViewProjectionMatrix3, vp.projectionMatrix, modelViewProjectionMatrix3);

            device.queue.writeBuffer(
                sphere2UniformBuffer, 0,
                modelViewProjectionMatrix3.buffer,
                modelViewProjectionMatrix3.byteOffset,
                modelViewProjectionMatrix3.byteLength
            );
        }

        const swapView = gpu.context.getCurrentTexture().createView();
        if (msaaTexture) {
            renderPassDescription.colorAttachments[0].resolveTarget = swapView;
        } else {
            renderPassDescription.colorAttachments[0].view = swapView;
        }
        const commandEncoder = device.createCommandEncoder();
        const renderPass = commandEncoder.beginRenderPass(renderPassDescription as GPURenderPassDescriptor);

        renderPass.setPipeline(pipeline);

        // Draw torus
        renderPass.setVertexBuffer(0, torusVertexBuffer);
        renderPass.setBindGroup(0, uniformBindGroup1);
        renderPass.draw(torusNumberOfVertices);

        // Draw sphere 1 (moon)
        renderPass.setPipeline(spherePipeline);
        renderPass.setVertexBuffer(0, sphereVertexBuffer);
        renderPass.setBindGroup(0, sphereBindGroup);
        renderPass.draw(sphereNumberOfVertices);

        // Draw sphere 2 (earth)
        if (sphere2Active) {
            renderPass.setVertexBuffer(0, sphere2VertexBuffer);
            renderPass.setBindGroup(0, sphere2BindGroup);
            renderPass.draw(sphere2NumberOfVertices);
        }

        renderPass.end();

        device.queue.submit([commandEncoder.finish()]);
    }

    CreateAnimation(draw, rotation, isAnimation, () => parseFloat(tumbleSpeedInput.value));
}

Create3DObject(true);

window.addEventListener('resize', () => Create3DObject(true));

majorRadiusInput.addEventListener('input', () => {
    majorRadiusVal.textContent = majorRadiusInput.value;
    Create3DObject(true);
});

tubeRadiusInput.addEventListener('input', () => {
    tubeRadiusVal.textContent = tubeRadiusInput.value;
    const r = parseFloat(tubeRadiusInput.value);
    sphereRadiusInput.max = String((r - 0.05).toFixed(2));
    if (parseFloat(sphereRadiusInput.value) >= r) {
        sphereRadiusInput.value = String((r - 0.05).toFixed(2));
        sphereRadiusVal.textContent = sphereRadiusInput.value;
    }
    Create3DObject(true);
});

sphereRadiusInput.addEventListener('input', () => {
    sphereRadiusVal.textContent = sphereRadiusInput.value;
    Create3DObject(true);
});

tumbleSpeedInput.addEventListener('input', () => {
    tumbleSpeedVal.textContent = tumbleSpeedInput.value;
});

frictionInput.addEventListener('input', () => {
    frictionVal.textContent = frictionInput.value;
});

simStepsInput.addEventListener('input', () => {
    simStepsVal.textContent = simStepsInput.value;
});

msaaToggle.addEventListener('change', () => {
    Create3DObject(true);
});

renderScaleInput.addEventListener('input', () => {
    renderScaleVal.textContent = renderScaleInput.value;
    Create3DObject(true);
});
