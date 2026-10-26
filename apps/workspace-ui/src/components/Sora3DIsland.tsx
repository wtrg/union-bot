import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

import { AGENTS, AGENT_IDS } from '../utils/agents.ts';
import type { AgentDef } from '../utils/agents.ts';
export { AGENTS, AGENT_IDS } from '../utils/agents.ts';

interface MochiNode {
  agent: AgentDef;
  root: THREE.Group;
  bodyGroup: THREE.Group;
  bodyMesh: THREE.Mesh;
  jumpPhase: number;
  jumpIntensity: number;
  bobOffset: number;
  tagEl: HTMLDivElement;
  speechEl: HTMLDivElement;
  speechTimer: any;
}

export interface Sora3DIslandRef {
  triggerHappyBounce: (agentId: string, shortSpeech?: string) => void;
  triggerAzureGust: () => void;
  triggerRollCall: () => void;
  resetCamera: () => void;
  focusAgent: (agentId: string | null) => void;
  setDayTheme: (isDay: boolean) => void;
}

interface Sora3DIslandProps {
  motionEnabled?: boolean;
  onSelectAgent: (agentId: string) => void;
  focusedAgent: string | null;
  typingAgents: Set<string>;
  onRestoreLayout?: () => void;
  ref?: React.Ref<Sora3DIslandRef>;
}

export const Sora3DIsland = React.forwardRef<Sora3DIslandRef, Sora3DIslandProps>(
  ({ onSelectAgent, focusedAgent, typingAgents, onRestoreLayout, motionEnabled = true }, ref) => {
    const runtimeRef = useRef({ typingAgents, focusedAgent, onSelectAgent, motionEnabled });
    runtimeRef.current = { typingAgents, focusedAgent, onSelectAgent, motionEnabled };
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const labelsRef = useRef<HTMLDivElement>(null);

    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const islandGroupRef = useRef<THREE.Group | null>(null);
    const mochiNodesRef = useRef<Record<string, MochiNode>>({});
    const canopyClustersRef = useRef<THREE.Mesh[]>([]);
    const petalsSystemRef = useRef<THREE.Points | null>(null);
    const rippleRingsRef = useRef<{ mesh: THREE.Mesh; scale: number; opacity: number }[]>([]);
    const flyingPetalsRef = useRef<{ mesh: THREE.Mesh; start: THREE.Vector3; end: THREE.Vector3; progress: number }[]>([]);
    const treeGlowBoostRef = useRef<number>(0);
    const windBoostRef = useRef<number>(0);

    const camOrbitRef = useRef({
      radius: 15.2,
      targetRadius: 15.2,
      theta: 0.42,
      targetTheta: 0.42,
      phi: 1.08,
      targetPhi: 1.08,
      lookAt: new THREE.Vector3(0, 1.35, 0),
      targetLookAt: new THREE.Vector3(0, 1.35, 0),
    });

    const triggerHappyBounce = (agentId: string, shortSpeech?: string) => {
      const node = mochiNodesRef.current[agentId];
      const island = islandGroupRef.current;
      if (!node || !island) return;

      node.jumpIntensity = 1.35;
      node.jumpPhase = 0;
      treeGlowBoostRef.current = 1.2;

      if (shortSpeech && node.speechEl) {
        node.speechEl.textContent = `${node.agent.emoji} ${shortSpeech}`;
        node.speechEl.classList.remove('hidden');
        clearTimeout(node.speechTimer);
        node.speechTimer = setTimeout(() => {
          node.speechEl?.classList.add('hidden');
        }, 2800);
      }

      const rGeo = new THREE.RingGeometry(0.5, 0.75, 24);
      const rMat = new THREE.MeshBasicMaterial({
        color: node.agent.colorHex,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      });
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.rotation.x = -Math.PI / 2;
      rMesh.position.copy(node.root.position);
      rMesh.position.y = 0.08;
      island.add(rMesh);
      rippleRingsRef.current.push({ mesh: rMesh, scale: 1, opacity: 0.9 });

      for (let i = 0; i < 3; i++) {
        const pGeo = new THREE.SphereGeometry(0.14 - i * 0.02, 10, 10);
        const pMat = new THREE.MeshBasicMaterial({ color: node.agent.colorHex });
        const pMesh = new THREE.Mesh(pGeo, pMat);
        pMesh.position.copy(node.root.position);
        pMesh.position.y += 0.9;
        island.add(pMesh);

        flyingPetalsRef.current.push({
          mesh: pMesh,
          start: node.root.position.clone().add(new THREE.Vector3(0, 0.9, 0)),
          end: new THREE.Vector3(0, 3.8, 0),
          progress: -i * 0.12,
        });
      }
    };

    const triggerAzureGust = () => {
      windBoostRef.current = 2.4;
      treeGlowBoostRef.current = 1.5;
      AGENT_IDS.forEach((id, i) => {
        setTimeout(() => {
          triggerHappyBounce(id, 'Gió Lam Ngọc! 💎');
        }, i * 80);
      });
    };

    const triggerRollCall = () => {
      windBoostRef.current = 2.0;
      AGENT_IDS.forEach((id, i) => {
        setTimeout(() => {
          triggerHappyBounce(id, `${AGENTS[id].name} sẵn sàng! 💙`);
        }, i * 130);
      });
    };

    const resetCamera = () => {
      camOrbitRef.current.targetRadius = 15.2;
      camOrbitRef.current.targetPhi = 1.08;
      camOrbitRef.current.targetLookAt.set(0, 1.35, 0);
    };

    const focusAgent = (agentId: string | null) => {
      if (agentId && mochiNodesRef.current[agentId]) {
        camOrbitRef.current.targetRadius = 11.2;
        triggerHappyBounce(agentId, 'Sẵn sàng! 💙');
      } else {
        resetCamera();
      }
    };

    const setDayTheme = (isDay: boolean) => {
      if (sceneRef.current) {
        sceneRef.current.fog = isDay
          ? new THREE.FogExp2(0xe0f2fe, 0.014)
          : new THREE.FogExp2(0x061229, 0.018);
      }
    };

    React.useImperativeHandle(ref, () => ({
      triggerHappyBounce,
      triggerAzureGust,
      triggerRollCall,
      resetCamera,
      focusAgent,
      setDayTheme,
    }));

    useEffect(() => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const labelLayer = labelsRef.current;
      if (!container || !canvas || !labelLayer) return;

      const width = Math.max(260, container.clientWidth);
      const height = Math.max(200, container.clientHeight);

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x061229, 0.018);
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 140);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      rendererRef.current = renderer;

      const ambientLight = new THREE.AmbientLight(0xe0f2fe, 1.55);
      scene.add(ambientLight);

      const dirLight = new THREE.DirectionalLight(0xbae6fd, 1.5);
      dirLight.position.set(10, 20, 12);
      scene.add(dirLight);

      const corePointLight = new THREE.PointLight(0x38bdf8, 2.8, 28);
      corePointLight.position.set(0, 4.0, 0);
      scene.add(corePointLight);

      // 1. Island Base
      const islandGroup = new THREE.Group();
      scene.add(islandGroup);
      islandGroupRef.current = islandGroup;

      const meadowGeo = new THREE.CylinderGeometry(7.0, 6.4, 0.85, 48);
      const meadowMat = new THREE.MeshStandardMaterial({
        color: 0xbae6fd,
        roughness: 0.6,
        metalness: 0.1,
      });
      const meadow = new THREE.Mesh(meadowGeo, meadowMat);
      meadow.position.y = -0.42;
      islandGroup.add(meadow);

      const carpetGeo = new THREE.RingGeometry(1.0, 3.5, 48);
      const carpetMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45,
      });
      const carpet = new THREE.Mesh(carpetGeo, carpetMat);
      carpet.rotation.x = -Math.PI / 2;
      carpet.position.y = 0.02;
      islandGroup.add(carpet);

      const rockGeo = new THREE.ConeGeometry(6.3, 3.6, 14);
      const rockMat = new THREE.MeshStandardMaterial({
        color: 0x1e3a8a,
        roughness: 0.8,
        flatShading: true,
      });
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.rotation.x = Math.PI;
      rock.position.y = -2.65;
      islandGroup.add(rock);

      const haloGeo = new THREE.TorusGeometry(7.7, 0.05, 16, 96);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.75,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.rotation.x = Math.PI / 2;
      halo.position.y = -0.1;
      islandGroup.add(halo);

      // 2. Sakura Tree
      const treeGroup = new THREE.Group();
      islandGroup.add(treeGroup);

      const trunkMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.7,
      });
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.64, 2.9, 16), trunkMat);
      trunk.position.y = 1.45;
      treeGroup.add(trunk);

      [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].forEach((ang) => {
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.28, 1.9, 12), trunkMat);
        branch.position.set(Math.cos(ang) * 0.68, 2.7, Math.sin(ang) * 0.68);
        branch.rotation.z = -Math.cos(ang) * 0.55;
        branch.rotation.x = Math.sin(ang) * 0.55;
        treeGroup.add(branch);
      });

      const blossomSpecs = [
        { x: 0, y: 4.1, z: 0, r: 1.75, c: 0x7dd3fc },
        { x: 1.3, y: 3.6, z: 0.55, r: 1.3, c: 0x38bdf8 },
        { x: -1.3, y: 3.55, z: 0.45, r: 1.35, c: 0xbae6fd },
        { x: 0.45, y: 3.7, z: 1.3, r: 1.25, c: 0x60a5fa },
        { x: -0.4, y: 3.6, z: -1.3, r: 1.3, c: 0x38bdf8 },
        { x: 1.05, y: 3.25, z: -0.95, r: 1.1, c: 0x93c5fd },
        { x: -1.05, y: 3.35, z: -0.9, r: 1.12, c: 0x7dd3fc },
        { x: 0, y: 4.85, z: 0, r: 1.2, c: 0xe0f2fe },
      ];

      const clusters: THREE.Mesh[] = [];
      blossomSpecs.forEach((sp, idx) => {
        const geo = new THREE.IcosahedronGeometry(sp.r, 2);
        const mat = new THREE.MeshStandardMaterial({
          color: sp.c,
          emissive: 0x0284c7,
          emissiveIntensity: 0.34,
          roughness: 0.42,
          transparent: true,
          opacity: 0.94,
        });
        const puff = new THREE.Mesh(geo, mat);
        puff.position.set(sp.x, sp.y, sp.z);
        puff.userData = { baseY: sp.y, phase: idx * 0.9 };
        treeGroup.add(puff);
        clusters.push(puff);
      });
      canopyClustersRef.current = clusters;

      // 3. Azure Torii Gate
      const toriiGroup = new THREE.Group();
      toriiGroup.position.set(0, 0, -4.0);
      islandGroup.add(toriiGroup);

      const blueGateMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 });
      const topDarkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 });

      [-0.95, 0.95].forEach((xPos) => {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.25, 16), blueGateMat);
        pillar.position.set(xPos, 1.12, 0);
        toriiGroup.add(pillar);
      });

      const topBeam = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.18, 0.24), topDarkMat);
      topBeam.position.set(0, 2.25, 0);
      toriiGroup.add(topBeam);

      const subBeam = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.14, 0.16), blueGateMat);
      subBeam.position.set(0, 1.86, 0);
      toriiGroup.add(subBeam);

      // 4. Six Cute Mochi Spirits
      labelLayer.innerHTML = '';
      const nodes: Record<string, MochiNode> = {};

      AGENT_IDS.forEach((id, idx) => {
        const ag = AGENTS[id];
        const mochiRoot = new THREE.Group();

        const x = Math.cos(ag.angle) * ag.radius;
        const z = Math.sin(ag.angle) * ag.radius;
        mochiRoot.position.set(x, 0, z);
        mochiRoot.lookAt(0, 0.6, 2.2);
        islandGroup.add(mochiRoot);

        const bodyGroup = new THREE.Group();
        mochiRoot.add(bodyGroup);

        const bodyGeo = new THREE.SphereGeometry(0.68, 26, 20);
        const bodyMat = new THREE.MeshStandardMaterial({
          color: ag.colorHex,
          emissive: ag.colorHex,
          emissiveIntensity: 0.25,
          roughness: 0.32,
          metalness: 0.08,
        });
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        bodyMesh.scale.set(1.08, 0.86, 1.04);
        bodyMesh.position.y = 0.56;
        bodyMesh.userData = { agentId: ag.id };
        bodyGroup.add(bodyMesh);

        const eyeGeo = new THREE.SphereGeometry(0.075, 12, 12);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.21, 0.62, 0.62);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.21, 0.62, 0.62);
        bodyGroup.add(leftEye, rightEye);

        if (ag.earType === 'bunny') {
          [-0.22, 0.22].forEach((ex) => {
            const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.64, 12), bodyMat);
            ear.position.set(ex, 1.24, 0);
            ear.rotation.z = ex > 0 ? -0.18 : 0.18;
            bodyGroup.add(ear);
          });
        } else {
          [-0.32, 0.32].forEach((ex) => {
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.42, 12), bodyMat);
            ear.position.set(ex, 1.12, 0);
            ear.rotation.z = ex > 0 ? -0.35 : 0.35;
            bodyGroup.add(ear);
          });
        }

        const pad = new THREE.Mesh(
          new THREE.CylinderGeometry(0.84, 0.9, 0.09, 24),
          new THREE.MeshStandardMaterial({ color: 0xe0f2fe, roughness: 0.6 })
        );
        pad.position.y = 0.05;
        mochiRoot.add(pad);

        // 2D Label DOM
        const tagEl = document.createElement('div');
        tagEl.className =
          'mochi-3d-tag px-1.5 py-0.5 rounded-full blue-glass flex items-center gap-1 shadow-md';
        tagEl.style.borderColor = ag.colorCss;
        tagEl.innerHTML = `<span class="text-[9.5px]">${ag.emoji}</span><span class="font-display font-bold text-[9.5px] text-theme-main">${ag.name}</span>`;
        tagEl.onclick = (e) => {
          e.stopPropagation();
          runtimeRef.current.onSelectAgent(ag.id);
        };
        labelLayer.appendChild(tagEl);

        const speechEl = document.createElement('div');
        speechEl.className =
          'mochi-3d-speech hidden px-2 py-0.5 rounded-xl bg-sky-950/95 text-sky-100 font-display font-bold text-[9.5px] shadow-xl border whitespace-nowrap';
        speechEl.style.borderColor = ag.colorCss;
        labelLayer.appendChild(speechEl);

        nodes[ag.id] = {
          agent: ag,
          root: mochiRoot,
          bodyGroup,
          bodyMesh,
          jumpPhase: 0,
          jumpIntensity: 0,
          bobOffset: idx * 1.1,
          tagEl,
          speechEl,
          speechTimer: null,
        };
      });
      mochiNodesRef.current = nodes;

      // 5. Falling Ice-Blue Petals
      const petalCount = 480;
      const positions = new Float32Array(petalCount * 3);
      const colors = new Float32Array(petalCount * 3);
      const velocities: { vx: number; vy: number; vz: number; sway: number }[] = [];

      const palette = [
        new THREE.Color(0x7dd3fc),
        new THREE.Color(0x38bdf8),
        new THREE.Color(0xbae6fd),
        new THREE.Color(0xe0f2fe),
      ];

      for (let i = 0; i < petalCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 26;
        positions[i * 3 + 1] = Math.random() * 15 - 2;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 24;

        velocities.push({
          vx: 0.01 + Math.random() * 0.015,
          vy: -(0.016 + Math.random() * 0.022),
          vz: (Math.random() - 0.5) * 0.014,
          sway: Math.random() * Math.PI * 2,
        });

        const c = palette[i % palette.length];
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }

      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      pGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const pMat = new THREE.PointsMaterial({
        size: 0.2,
        vertexColors: true,
        transparent: true,
        opacity: 0.88,
      });

      const petals = new THREE.Points(pGeo, pMat);
      petals.userData = { velocities };
      scene.add(petals);
      petalsSystemRef.current = petals;

      // Raycaster & Interaction
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2(-999, -999);
      let isDragging = false;
      let prevPointer = { x: 0, y: 0 };
      let downPointer = { x: 0, y: 0 };

      const handleMouseDown = (e: MouseEvent) => {
        isDragging = true;
        prevPointer = { x: e.clientX, y: e.clientY };
        downPointer = { x: e.clientX, y: e.clientY };
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - prevPointer.x;
        const dy = e.clientY - prevPointer.y;
        camOrbitRef.current.targetTheta -= dx * 0.007;
        camOrbitRef.current.targetPhi = Math.max(
          0.45,
          Math.min(1.42, camOrbitRef.current.targetPhi - dy * 0.006)
        );
        prevPointer = { x: e.clientX, y: e.clientY };
      };

      const handleMouseUp = (e: MouseEvent) => {
        if (!isDragging) return;
        isDragging = false;
        if (Math.hypot(e.clientX - downPointer.x, e.clientY - downPointer.y) < 6) {
          const rect = container.getBoundingClientRect();
          mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);

          const meshes = Object.values(mochiNodesRef.current).map((n) => n.bodyMesh);
          const hits = raycaster.intersectObjects(meshes, false);
          if (hits.length > 0) {
            const hitAgentId = (hits[0].object as any).userData?.agentId;
            if (hitAgentId) runtimeRef.current.onSelectAgent(hitAgentId);
          }
        }
      };

      const handleWheel = (e: WheelEvent) => {
        camOrbitRef.current.targetRadius = Math.max(
          9.0,
          Math.min(23.0, camOrbitRef.current.targetRadius + e.deltaY * 0.01)
        );
      };

      canvas.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      canvas.addEventListener('wheel', handleWheel, { passive: true });

      // Resize Observer
      const handleResize = () => {
        if (!container || !renderer || !camera) return;
        const w = Math.max(200, container.clientWidth);
        const h = Math.max(160, container.clientHeight);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };

      const ro = new ResizeObserver(handleResize);
      ro.observe(container);

      // Animation Loop
      const clock = new THREE.Clock();
      let animId: number;

      const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      let lastFrame = 0;
      const animate = () => {
        animId = requestAnimationFrame(animate);
        const now = performance.now();
        const reduceMotion = motionQuery.matches || !runtimeRef.current.motionEnabled;
        if (document.hidden || now - lastFrame < (reduceMotion ? 250 : 1000 / 30)) return;
        lastFrame = now;
        const { typingAgents, focusedAgent } = runtimeRef.current;
        const delta = reduceMotion ? 0 : Math.min(clock.getDelta(), 0.05);
        const elapsed = reduceMotion ? 0 : clock.getElapsedTime();

        if (islandGroup) {
          islandGroup.position.y = Math.sin(elapsed * 1.4) * 0.1;
        }

        canopyClustersRef.current.forEach((puff) => {
          const s =
            1 +
            Math.sin(elapsed * 2.2 + puff.userData.phase) * 0.03 +
            treeGlowBoostRef.current * 0.05;
          puff.scale.set(s, s, s);
          (puff.material as THREE.MeshStandardMaterial).emissiveIntensity =
            0.28 + treeGlowBoostRef.current * 0.42;
        });
        treeGlowBoostRef.current = Math.max(0, treeGlowBoostRef.current - delta * 1.6);

        AGENT_IDS.forEach((id) => {
          const node = mochiNodesRef.current[id];
          if (!node) return;

          if (!reduceMotion && typingAgents.has(id) && node.jumpIntensity < 0.25) {
            node.jumpIntensity = 0.3;
          }

          if (reduceMotion) {
            node.bodyGroup.position.y = 0;
            node.bodyGroup.scale.set(1, 1, 1);
          } else if (node.jumpIntensity > 0.01) {
            node.jumpPhase += delta * 11.5;
            const jumpWave = Math.abs(Math.sin(node.jumpPhase));
            node.bodyGroup.position.y = jumpWave * 0.85 * node.jumpIntensity;

            const stretch = 1 + Math.sin(node.jumpPhase * 2) * 0.15 * node.jumpIntensity;
            node.bodyGroup.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));

            node.jumpIntensity = Math.max(0, node.jumpIntensity - delta * 0.95);
          } else {
            node.bodyGroup.position.y = Math.sin(elapsed * 2.5 + node.bobOffset) * 0.045;
            const idleBreath = 1 + Math.sin(elapsed * 3.0 + node.bobOffset) * 0.025;
            node.bodyGroup.scale.set(idleBreath, 2 - idleBreath, idleBreath);
          }
        });

        if (petalsSystemRef.current && !reduceMotion) {
          const posAttr = petalsSystemRef.current.geometry.attributes.position;
          const arr = posAttr.array as Float32Array;
          const vels = petalsSystemRef.current.userData.velocities;
          const windMultiplier = 1 + windBoostRef.current;

          for (let i = 0; i < vels.length; i++) {
            const v = vels[i];
            arr[i * 3] += (v.vx + Math.sin(elapsed * 1.5 + v.sway) * 0.01) * windMultiplier;
            arr[i * 3 + 1] += v.vy * (1 + windBoostRef.current * 0.4);
            arr[i * 3 + 2] += (v.vz + Math.cos(elapsed * 1.3 + v.sway) * 0.01) * windMultiplier;

            if (arr[i * 3 + 1] < -4) {
              arr[i * 3 + 1] = 13;
              arr[i * 3] = (Math.random() - 0.5) * 24;
            }
            if (arr[i * 3] > 14) arr[i * 3] = -14;
          }
          posAttr.needsUpdate = true;
          windBoostRef.current = Math.max(0, windBoostRef.current - delta * 1.2);
        }

        // Ripple rings
        for (let i = rippleRingsRef.current.length - 1; i >= 0; i--) {
          const rp = rippleRingsRef.current[i];
          rp.scale += delta * 3.2;
          rp.opacity -= delta * 1.2;
          rp.mesh.scale.set(rp.scale, rp.scale, rp.scale);
          (rp.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, rp.opacity);
          if (rp.opacity <= 0) {
            islandGroup.remove(rp.mesh);
            rippleRingsRef.current.splice(i, 1);
          }
        }

        // Flying petals
        for (let i = flyingPetalsRef.current.length - 1; i >= 0; i--) {
          const fp = flyingPetalsRef.current[i];
          fp.progress += delta * 1.9;
          if (fp.progress < 0) {
            fp.mesh.visible = false;
            continue;
          }
          fp.mesh.visible = true;
          if (fp.progress >= 1) {
            islandGroup.remove(fp.mesh);
            flyingPetalsRef.current.splice(i, 1);
            treeGlowBoostRef.current = Math.min(1.8, treeGlowBoostRef.current + 0.25);
            continue;
          }
          const t = fp.progress;
          fp.mesh.position.lerpVectors(fp.start, fp.end, t);
          fp.mesh.position.y += Math.sin(t * Math.PI) * 1.8;
        }

        // Camera follow
        const camOrbit = camOrbitRef.current;
        if (focusedAgent && mochiNodesRef.current[focusedAgent]) {
          const worldPos = new THREE.Vector3();
          mochiNodesRef.current[focusedAgent].root.getWorldPosition(worldPos);
          worldPos.y += 0.85;
          camOrbit.targetLookAt.copy(worldPos);
        } else {
          camOrbit.targetLookAt.set(0, 1.35, 0);
        }

        if (!reduceMotion && !isDragging && !focusedAgent) {
          camOrbit.targetTheta += 0.06 * delta;
        }

        camOrbit.radius += (camOrbit.targetRadius - camOrbit.radius) * 0.07;
        camOrbit.theta += (camOrbit.targetTheta - camOrbit.theta) * 0.07;
        camOrbit.phi += (camOrbit.targetPhi - camOrbit.phi) * 0.07;
        camOrbit.lookAt.lerp(camOrbit.targetLookAt, 0.08);

        camera.position.x =
          camOrbit.lookAt.x +
          camOrbit.radius * Math.sin(camOrbit.phi) * Math.sin(camOrbit.theta);
        camera.position.y = camOrbit.lookAt.y + camOrbit.radius * Math.cos(camOrbit.phi);
        camera.position.z =
          camOrbit.lookAt.z +
          camOrbit.radius * Math.sin(camOrbit.phi) * Math.cos(camOrbit.theta);
        camera.lookAt(camOrbit.lookAt);

        // Project 2D Labels
        const halfW = container.clientWidth / 2;
        const halfH = container.clientHeight / 2;

        AGENT_IDS.forEach((id) => {
          const node = mochiNodesRef.current[id];
          if (!node) return;

          const worldPos = new THREE.Vector3();
          node.bodyGroup.getWorldPosition(worldPos);
          worldPos.y += 1.15;
          worldPos.project(camera);

          if (worldPos.z > 1) {
            node.tagEl.style.opacity = '0';
            node.speechEl.style.opacity = '0';
            return;
          }

          const sx = worldPos.x * halfW + halfW;
          const sy = -(worldPos.y * halfH) + halfH;

          node.tagEl.style.opacity = '0.96';
          node.tagEl.style.left = `${sx}px`;
          node.tagEl.style.top = `${sy}px`;

          node.speechEl.style.opacity = '1';
          node.speechEl.style.left = `${sx}px`;
          node.speechEl.style.top = `${sy}px`;
        });

        renderer.render(scene, camera);
      };

      animate();

      return () => {
        cancelAnimationFrame(animId);
        ro.disconnect();
        canvas.removeEventListener('mousedown', handleMouseDown);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        canvas.removeEventListener('wheel', handleWheel);
        AGENT_IDS.forEach(id => { clearTimeout(mochiNodesRef.current[id]?.speechTimer); });
        scene.traverse(object => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose();
          const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          materials.forEach(material => material.dispose());
        });
        labelsRef.current?.replaceChildren();
        mochiNodesRef.current = {};
        renderer.dispose();
      };
    }, []);

    const focusedAgentInfo = focusedAgent ? AGENTS[focusedAgent] : null;

    return (
      <div
        id="left3dViewport"
        ref={containerRef}
        className="blue-glass viewport-3d-surface rounded-2xl relative flex-1 min-h-[210px] overflow-hidden flex flex-col justify-between"
      >
        <canvas
          id="sora-canvas"
          ref={canvasRef}
          className="absolute inset-0 w-full h-full block cursor-grab active:cursor-grabbing"
        />

        {/* 2D Projected Mochi Name Tags & Speech Bubbles inside Viewport */}
        <div
          id="mochi-labels-layer"
          ref={labelsRef}
          className="absolute inset-0 pointer-events-none overflow-hidden z-10"
        />

        {/* Top Overlay Bar inside 3D Viewport */}
        <div className="relative z-20 p-2 flex items-center justify-between pointer-events-none">
          <div className="pointer-events-auto px-2.5 py-1 rounded-xl bg-slate-950/75 border border-sky-400/30 backdrop-blur-md flex items-center gap-1.5">
            <span className="text-xs">⛩️</span>
            <span className="font-display font-bold text-[11px] text-sky-100">Đảo Hoa Lam 3D</span>
            <span
              id="focused-mochi-badge"
              className="px-1.5 py-0.2 rounded bg-sky-500/30 text-sky-200 text-[9.5px] font-bold"
            >
              {focusedAgentInfo ? `${focusedAgentInfo.emoji} ${focusedAgentInfo.name}` : 'Mascot · xem trạng thái ở thanh AI'}
            </span>
          </div>

          <div className="pointer-events-auto flex items-center gap-1">
            <button
              type="button"
              onClick={triggerRollCall}
              className="btn-pop px-2 py-0.5 rounded-lg bg-slate-950/75 hover:bg-sky-900/80 border border-sky-400/30 text-[10px] font-display font-bold text-sky-200"
              title="Cho cả 6 bé Mochi nhảy điểm danh 3D"
            >
              🍡 6 AI Nhảy
            </button>
            <button
              type="button"
              onClick={resetCamera}
              className="btn-pop px-2 py-0.5 rounded-lg bg-slate-950/75 hover:bg-sky-900/80 border border-sky-400/30 text-[10px] font-display font-bold text-sky-300"
              title="Góc nhìn toàn cảnh đảo 3D"
            >
              🎥 Reset
            </button>
          </div>
        </div>

        {/* Bottom Mini Guide Pill inside 3D Viewport */}
        <div className="relative z-20 p-2 flex items-center justify-between pointer-events-none">
          <span className="px-2 py-0.5 rounded-lg bg-slate-950/65 text-[9.5px] text-sky-200/90 border border-sky-400/20">
            🖱️ Kéo để xoay đảo • Cuộn để zoom • Bấm Mochi 3D để gọi
          </span>
          {onRestoreLayout && (
            <button
              type="button"
              onClick={onRestoreLayout}
              className="pointer-events-auto btn-pop px-3 py-1 rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 text-white text-[11px] font-display font-bold shadow-lg"
            >
              💬 Mở Lại 70% Chat
            </button>
          )}
        </div>
      </div>
    );
  }
);
