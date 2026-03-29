import { InitGPU, CreateGPUBuffer, CreateGPUBufferUint, CreateTransforms, CreateViewProjection, CreateAnimation } from './helper';
import { Shaders } from './shaders';
import { vec3, mat4, quat } from 'gl-matrix';
import { TorusWireframeData, SphereWireframeData } from './vertex_data';
import "./site.css";

const Create3DObject = async (isAnimation = true) => {
    const gpu = await InitGPU();
    const device = gpu.device;

    const majorRadiusInput = document.getElementById('major-radius') as HTMLInputElement;
    const tubeRadiusInput  = document.getElementById('tube-radius')  as HTMLInputElement;
    let R = parseFloat(majorRadiusInput.value);
    let r = parseFloat(tubeRadiusInput.value);
    let N = 20, n = 20;
    let torusColor: vec3 = vec3.fromValues(1, 0, 0);
    let sphereColor: vec3 = vec3.fromValues(0, 1, 0);
    let torusCenter: vec3 = [0, 0, 0], sphereCenter: vec3 = [0, 0, 0];
    const sphereRadiusInput = document.getElementById('sphere-radius') as HTMLInputElement;
    let sphereRadius = parseFloat(sphereRadiusInput.value);
    const torusWireframeData = TorusWireframeData(R, r, N, n, torusCenter, torusColor) as Float32Array;
    const sphereWireframeData = SphereWireframeData(sphereRadius, 20, 20, sphereCenter, sphereColor) as Float32Array;

    // Create vertex buffers
    const torusNumberOfVertices = torusWireframeData.length / 6;
    const torusVertexBuffer = CreateGPUBuffer(device, torusWireframeData);
    const sphereNumberOfVertices = sphereWireframeData.length / 6;
    const sphereVertexBuffer = CreateGPUBuffer(device, sphereWireframeData);

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
            topology: "line-list",
        },
        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less"
        }
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
    const translateMatrix2 = mat4.create();
    const modelViewProjectionMatrix2 = mat4.create() as Float32Array;

    // Physics state — sphere lives in torus local frame
    const sphereSpeed = 1.5;
    const spherePos = vec3.fromValues(R, 0, 0);

    // Initial velocity: random unit vector within 30° cone around orbit tangent (0, 0, -1) at start position
    const halfAngle = Math.PI / 6;
    const phi = Math.random() * 2 * Math.PI;
    const cosTheta = Math.cos(halfAngle) + Math.random() * (1 - Math.cos(halfAngle));
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    const sphereVel = vec3.fromValues(
        sinTheta * Math.cos(phi),
        sinTheta * Math.sin(phi),
        -cosTheta
    );
    vec3.scale(sphereVel, sphereVel, sphereSpeed);
    const sphereOmega = vec3.create();
    const sphereQuat  = quat.create();
    const frictionInput = document.getElementById('friction') as HTMLInputElement;
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
                size: matrixSize
            }
        }]
    });

    const uniformBindGroup2 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: {
                buffer: uniformBuffer,
                offset: uniformOffset,
                size: matrixSize
            }
        }]
    });

    let textureView = gpu.context.getCurrentTexture().createView();
    const depthTexture = device.createTexture({
        size: [gpu.canvas.width, gpu.canvas.height, 1],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    const renderPassDescription = {
        colorAttachments: [{
            view: textureView,
            clearValue: { r: 0.2, g: 0.247, b: 0.314, a: 1.0 }, // Background color
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

        spherePos[0] += sphereVel[0] * dt;
        spherePos[1] += sphereVel[1] * dt;
        spherePos[2] += sphereVel[2] * dt;

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

        // Integrate angular velocity into orientation quaternion
        const omegaLen = vec3.length(sphereOmega);
        if (omegaLen > 1e-8) {
            const axis = vec3.scale(vec3.create(), sphereOmega, 1 / omegaLen);
            const dq = quat.setAxisAngle(quat.create(), axis, omegaLen * dt);
            quat.multiply(sphereQuat, dq, sphereQuat);
            quat.normalize(sphereQuat, sphereQuat);
        }

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

        device.queue.writeBuffer(
            uniformBuffer,
            uniformOffset,
            modelViewProjectionMatrix2.buffer,
            modelViewProjectionMatrix2.byteOffset,
            modelViewProjectionMatrix2.byteLength
        );

        textureView = gpu.context.getCurrentTexture().createView();
        renderPassDescription.colorAttachments[0].view = textureView;
        const commandEncoder = device.createCommandEncoder();
        const renderPass = commandEncoder.beginRenderPass(renderPassDescription as GPURenderPassDescriptor);

        renderPass.setPipeline(pipeline);

        // Draw torus
        renderPass.setVertexBuffer(0, torusVertexBuffer);
        renderPass.setBindGroup(0, uniformBindGroup1);
        renderPass.draw(torusNumberOfVertices);

        // Draw sphere
        renderPass.setVertexBuffer(0, sphereVertexBuffer);
        renderPass.setBindGroup(0, uniformBindGroup2);
        renderPass.draw(sphereNumberOfVertices);

        renderPass.end();

        device.queue.submit([commandEncoder.finish()]);
    }

    const tumbleSpeedInput = document.getElementById('tumble-speed') as HTMLInputElement;
    CreateAnimation(draw, rotation, isAnimation, () => parseFloat(tumbleSpeedInput.value));
}

Create3DObject(true);

window.addEventListener('resize', () => Create3DObject(false));

const majorRadiusInput = document.getElementById('major-radius') as HTMLInputElement;
const majorRadiusVal   = document.getElementById('major-radius-val') as HTMLSpanElement;
majorRadiusInput.addEventListener('input', () => {
    majorRadiusVal.textContent = majorRadiusInput.value;
    Create3DObject(true);
});

const tubeRadiusInput = document.getElementById('tube-radius') as HTMLInputElement;
const tubeRadiusVal   = document.getElementById('tube-radius-val') as HTMLSpanElement;
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

const sphereRadiusInput = document.getElementById('sphere-radius') as HTMLInputElement;
const sphereRadiusVal   = document.getElementById('sphere-radius-val') as HTMLSpanElement;
sphereRadiusInput.addEventListener('input', () => {
    sphereRadiusVal.textContent = sphereRadiusInput.value;
    Create3DObject(true);
});

const tumbleSpeedInput = document.getElementById('tumble-speed') as HTMLInputElement;
const tumbleSpeedVal   = document.getElementById('tumble-speed-val') as HTMLSpanElement;
tumbleSpeedInput.addEventListener('input', () => {
    tumbleSpeedVal.textContent = tumbleSpeedInput.value;
});

const frictionInput = document.getElementById('friction') as HTMLInputElement;
const frictionVal   = document.getElementById('friction-val') as HTMLSpanElement;
frictionInput.addEventListener('input', () => {
    frictionVal.textContent = frictionInput.value;
});
