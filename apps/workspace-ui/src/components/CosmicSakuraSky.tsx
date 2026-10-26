import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";

export interface CosmicSakuraSkyRef {
  triggerMeteorShower: (count?: number) => void;
  triggerSakuraBurst: (x: number, y: number, count?: number) => void;
  cycleDensity: () => string;
  getDensityLabel: () => string;
}

interface CosmicSakuraSkyProps {
  motionEnabled?: boolean;
}

export const CosmicSakuraSky = forwardRef<CosmicSakuraSkyRef, CosmicSakuraSkyProps>(
  ({ motionEnabled = true }, ref) => {
    const isTestMode =
      typeof window !== "undefined" && Boolean((window as any).__workspaceTest);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // 0 = Rực rỡ (36 petals + frequent meteors), 1 = Dịu nhẹ (18 petals), 2 = Chỉ sao băng (0 petals)
    const [densityMode, setDensityMode] = useState(0);
    const densityRef = useRef(densityMode);
    densityRef.current = densityMode;

    const densityLabels = ["Hoa & Sao: Rực rỡ", "Hoa & Sao: Dịu nhẹ", "Chỉ Sao Băng"];

    const triggerBurstRef = useRef<((x: number, y: number, count?: number) => void) | null>(null);
    const triggerMeteorRef = useRef<((count?: number) => void) | null>(null);

    useImperativeHandle(ref, () => ({
      triggerMeteorShower: (count = 6) => {
        triggerMeteorRef.current?.(count);
      },
      triggerSakuraBurst: (x, y, count = 14) => {
        triggerBurstRef.current?.(x, y, count);
      },
      cycleDensity: () => {
        const next = (densityRef.current + 1) % 3;
        setDensityMode(next);
        return densityLabels[next];
      },
      getDensityLabel: () => densityLabels[densityRef.current],
    }));

    useEffect(() => {
      if (isTestMode || !motionEnabled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let animationFrameId: number;
      let stars: Array<{ x: number; y: number; r: number; phase: number; color: string }> = [];
      let petals: SakuraPetal[] = [];
      let burstPetals: Array<{ x: number; y: number; vx: number; vy: number; size: number; rot: number; alpha: number }> = [];
      let shootingStars: ShootingStar[] = [];

      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      window.addEventListener("resize", resize);
      resize();

      // Twinkling stars
      for (let i = 0; i < 64; i++) {
        const rand = Math.random();
        stars.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight * 0.85,
          r: Math.random() * 1.5 + 0.4,
          phase: Math.random() * Math.PI * 2,
          color: rand > 0.5 ? "#fbcfe8" : rand > 0.2 ? "#7dd3fc" : "#ffffff",
        });
      }

      const getWidth = () => canvas.width;
      const getHeight = () => canvas.height;

      class ShootingStar {
        x: number;
        y: number;
        vx: number;
        vy: number;
        length: number;
        life: number;
        decay: number;
        isPink: boolean;

        constructor(startX?: number, startY?: number) {
          this.x = startX !== undefined ? startX : Math.random() * getWidth() * 0.85 + getWidth() * 0.1;
          this.y = startY !== undefined ? startY : Math.random() * getHeight() * 0.35;
          const angle = Math.PI * 0.78 + (Math.random() - 0.5) * 0.14;
          const speed = Math.random() * 7 + 9;
          this.vx = Math.cos(angle) * speed;
          this.vy = Math.sin(angle) * speed;
          this.length = Math.random() * 110 + 95;
          this.life = 1.0;
          this.decay = Math.random() * 0.012 + 0.012;
          this.isPink = Math.random() > 0.4;
        }

        update() {
          this.x += this.vx;
          this.y += this.vy;
          this.life -= this.decay;
        }

        draw(c: CanvasRenderingContext2D) {
          if (this.life <= 0) return;
          c.save();
          c.globalAlpha = Math.max(0, this.life);

          const norm = Math.hypot(this.vx, this.vy);
          const tailX = this.x - (this.vx / norm) * this.length;
          const tailY = this.y - (this.vy / norm) * this.length;

          const grad = c.createLinearGradient(this.x, this.y, tailX, tailY);
          grad.addColorStop(0, "#ffffff");
          grad.addColorStop(0.25, this.isPink ? "#f472b6" : "#38bdf8");
          grad.addColorStop(0.65, this.isPink ? "rgba(56, 189, 248, 0.45)" : "rgba(244, 114, 182, 0.45)");
          grad.addColorStop(1, "rgba(244, 114, 182, 0)");

          c.strokeStyle = grad;
          c.lineWidth = 2.4;
          c.lineCap = "round";
          c.beginPath();
          c.moveTo(this.x, this.y);
          c.lineTo(tailX, tailY);
          c.stroke();

          const headGlow = c.createRadialGradient(this.x, this.y, 0.5, this.x, this.y, 8);
          headGlow.addColorStop(0, "#ffffff");
          headGlow.addColorStop(0.45, this.isPink ? "#fbcfe8" : "#bae6fd");
          headGlow.addColorStop(1, "rgba(244, 114, 182, 0)");
          c.fillStyle = headGlow;
          c.beginPath();
          c.arc(this.x, this.y, 8, 0, Math.PI * 2);
          c.fill();

          c.restore();
        }
      }

      class SakuraPetal {
        x: number = 0;
        y: number = 0;
        z: number = 0;
        size: number = 0;
        vy: number = 0;
        vx: number = 0;
        rot: number = 0;
        vRot: number = 0;
        sway: number = 0;
        alpha: number = 0;

        constructor(randomY = true) {
          this.reset(randomY);
        }

        reset(randomY = false) {
          this.x = Math.random() * getWidth();
          this.y = randomY ? Math.random() * getHeight() : -20;
          this.z = Math.random() * 0.75 + 0.3;
          this.size = (Math.random() * 6 + 5.2) * this.z;
          this.vy = (Math.random() * 0.8 + 0.42) * this.z;
          this.vx = (Math.random() * 0.7 - 0.25) * this.z;
          this.rot = Math.random() * Math.PI * 2;
          this.vRot = (Math.random() - 0.5) * 0.022;
          this.sway = Math.random() * Math.PI * 2;
          this.alpha = Math.min(0.75, this.z * 0.65 + 0.18);
        }

        update() {
          this.sway += 0.016;
          this.x += this.vx + Math.sin(this.sway) * 0.45;
          this.y += this.vy;
          this.rot += this.vRot;
          if (this.y > getHeight() + 20 || this.x > getWidth() + 25 || this.x < -25) {
            this.reset(false);
          }
        }

        draw(c: CanvasRenderingContext2D) {
          c.save();
          c.translate(this.x, this.y);
          c.rotate(this.rot);
          c.scale(Math.cos(this.sway) * 0.38 + 0.62, 1);
          c.globalAlpha = this.alpha;
          const s = this.size;
          const grad = c.createRadialGradient(0, 0, 1, 0, 0, s);
          grad.addColorStop(0, "#ffffff");
          grad.addColorStop(0.55, "#fbcfe8");
          grad.addColorStop(1, "#f472b6");
          c.fillStyle = grad;
          c.beginPath();
          c.moveTo(0, s);
          c.bezierCurveTo(-s * 0.85, s * 0.35, -s * 0.8, -s * 0.6, -s * 0.2, -s);
          c.lineTo(0, -s * 0.65);
          c.lineTo(s * 0.2, -s);
          c.bezierCurveTo(s * 0.8, -s * 0.6, s * 0.85, s * 0.35, 0, s);
          c.closePath();
          c.fill();
          c.restore();
        }
      }

      const syncPetals = (count: number) => {
        while (petals.length < count) petals.push(new SakuraPetal(true));
        while (petals.length > count) petals.pop();
      };

      const counts = [34, 18, 0];
      syncPetals(counts[densityRef.current]);

      triggerBurstRef.current = (x: number, y: number, count = 14) => {
        for (let i = 0; i < count; i++) {
          const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
          const speed = Math.random() * 3.6 + 1.2;
          burstPetals.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 0.8,
            size: Math.random() * 5 + 4,
            rot: Math.random() * Math.PI * 2,
            alpha: 0.92,
          });
        }
      };

      triggerMeteorRef.current = (count = 6) => {
        for (let i = 0; i < count; i++) {
          setTimeout(() => {
            shootingStars.push(
              new ShootingStar(
                Math.random() * canvas.width * 0.9 + canvas.width * 0.08,
                Math.random() * canvas.height * 0.28,
              ),
            );
          }, i * 180);
        }
      };

      // Ambient shooting star interval
      const meteorInterval = setInterval(() => {
        if (document.hidden) return;
        if (shootingStars.length < 10) {
          shootingStars.push(new ShootingStar());
        }
      }, 3200);

      const render = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. Galaxy stars
        for (let i = 0; i < stars.length; i++) {
          const st = stars[i];
          st.phase += 0.025;
          ctx.save();
          ctx.globalAlpha = 0.28 + Math.sin(st.phase) * 0.22;
          ctx.fillStyle = st.color;
          ctx.beginPath();
          ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // 2. Shooting stars
        for (let i = shootingStars.length - 1; i >= 0; i--) {
          const m = shootingStars[i];
          m.update();
          m.draw(ctx);
          if (m.life <= 0 || m.x < -150 || m.y > canvas.height + 150) {
            shootingStars.splice(i, 1);
          }
        }

        // 3. Falling petals
        for (let i = 0; i < petals.length; i++) {
          petals[i].update();
          petals[i].draw(ctx);
        }

        // 4. Burst petals
        for (let i = burstPetals.length - 1; i >= 0; i--) {
          const p = burstPetals[i];
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.06;
          p.alpha -= 0.028;
          if (p.alpha <= 0) {
            burstPetals.splice(i, 1);
            continue;
          }
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = "#fbcfe8";
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 0.6, p.size, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        animationFrameId = requestAnimationFrame(render);
      };

      render();

      return () => {
        window.removeEventListener("resize", resize);
        clearInterval(meteorInterval);
        cancelAnimationFrame(animationFrameId);
      };
    }, [isTestMode, motionEnabled, densityMode]);

    return (
      <div className="ub-twilight-sky" aria-hidden="true">
        {/* CSS Meteors for test compatibility and baseline styling */}
        <span className="ub-meteor" />
        <span className="ub-meteor second" />

        {/* 1. Milky Way Diagonal Pink-Cyan Starlight Arch */}
        <div
          className="absolute -top-28 left-1/5 w-[1100px] h-[380px] -rotate-12 opacity-40 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(244,114,182,0.42) 0%, rgba(139,92,246,0.28) 38%, rgba(56,189,248,0.22) 62%, transparent 80%)",
            filter: "blur(42px)",
          }}
        />

        {/* 2. BLURRY PLANET #1: Ringed Sakura-Sapphire Gas Giant (Upper Right Sky) */}
        <div
          className="absolute top-4 right-[8%] w-72 h-72 planet-float-1 opacity-70 pointer-events-none"
          style={{ filter: "blur(1.5px)" }}
        >
          <div
            className="absolute inset-4 rounded-full opacity-55"
            style={{
              background:
                "radial-gradient(circle, rgba(244,114,182,0.45) 0%, rgba(56,189,248,0.25) 55%, transparent 75%)",
              filter: "blur(18px)",
            }}
          />
          <svg viewBox="0 0 320 320" className="w-full h-full overflow-visible">
            <defs>
              <linearGradient id="ringedPlanetBody" x1="15%" y1="10%" x2="85%" y2="90%">
                <stop offset="0%" stopColor="#fbcfe8" />
                <stop offset="30%" stopColor="#f472b6" />
                <stop offset="65%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#0f172a" />
              </linearGradient>
              <linearGradient id="planetRingGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(56,189,248,0.05)" />
                <stop offset="25%" stopColor="rgba(244,114,182,0.65)" />
                <stop offset="50%" stopColor="rgba(251,207,232,0.85)" />
                <stop offset="75%" stopColor="rgba(56,189,248,0.65)" />
                <stop offset="100%" stopColor="rgba(244,114,182,0.05)" />
              </linearGradient>
            </defs>
            <ellipse
              cx="160"
              cy="160"
              rx="148"
              ry="36"
              fill="none"
              stroke="url(#planetRingGrad)"
              strokeWidth="10"
              transform="rotate(-22 160 160)"
              opacity="0.55"
            />
            <circle cx="160" cy="160" r="76" fill="url(#ringedPlanetBody)" />
            <path
              d="M90,140 Q160,158 230,140"
              fill="none"
              stroke="rgba(251,207,232,0.35)"
              strokeWidth="6"
              strokeLinecap="round"
            />
            <path
              d="M86,168 Q160,186 234,168"
              fill="none"
              stroke="rgba(56,189,248,0.3)"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <path
              d="M 23,215 A 148,36 0 0 0 297,105"
              fill="none"
              stroke="url(#planetRingGrad)"
              strokeWidth="12"
              opacity="0.8"
            />
          </svg>
        </div>

        {/* 3. BLURRY PLANET #2: Misty Pink-Cyan Crescent Moon (Upper Left Sky) */}
        <div
          className="absolute top-10 left-[10%] w-44 h-44 planet-float-2 opacity-65 pointer-events-none"
          style={{ filter: "blur(2px)" }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 32% 30%, #fce7f3 0%, #f472b6 38%, #38bdf8 72%, transparent 82%)",
              boxShadow: "0 0 50px rgba(244,114,182,0.45)",
            }}
          />
          <div
            className="absolute top-3 left-6 w-36 h-36 rounded-full bg-[#090720] opacity-80"
            style={{ filter: "blur(6px)" }}
          />
        </div>

        {/* 4. BLURRY PLANET #3: Distant Rose-Violet Nebula Sphere */}
        <div
          className="absolute bottom-20 left-[20%] w-32 h-32 rounded-full planet-float-1 opacity-45 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 35% 35%, rgba(251,207,232,0.85), rgba(236,72,153,0.5) 45%, rgba(99,102,241,0.25) 75%, transparent)",
            filter: "blur(5px)",
          }}
        />

        {/* 5. LUMINOUS SAKURA TREE CANOPIES (Left & Right) */}
        <svg
          className="absolute -top-4 -left-6 w-[380px] h-[300px] canopy-left opacity-80 pointer-events-none"
          viewBox="0 0 430 340"
        >
          <defs>
            <radialGradient id="sakuraClusterLeft" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="45%" stopColor="#fbcfe8" stopOpacity="0.88" />
              <stop offset="78%" stopColor="#f472b6" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="cyanSakuraGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#e0f2fe" stopOpacity="0.9" />
              <stop offset="55%" stopColor="#38bdf8" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx="95" cy="70" rx="95" ry="55" fill="url(#sakuraClusterLeft)" />
          <ellipse cx="195" cy="52" rx="110" ry="48" fill="url(#sakuraClusterLeft)" />
          <ellipse cx="60" cy="145" rx="85" ry="50" fill="url(#sakuraClusterLeft)" />
          <ellipse cx="165" cy="115" rx="90" ry="45" fill="url(#sakuraClusterLeft)" />
          <ellipse cx="275" cy="82" rx="75" ry="38" fill="url(#cyanSakuraGlow)" />
          <path d="M-10,18 Q95,42 185,78 T315,92" fill="none" stroke="#2e1035" strokeWidth="7" strokeLinecap="round" />
          <path d="M55,36 Q115,95 175,135" fill="none" stroke="#2e1035" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M-10,95 Q55,120 115,165" fill="none" stroke="#2e1035" strokeWidth="5" strokeLinecap="round" />
          <circle cx="88" cy="58" r="7" fill="#ffffff" />
          <circle cx="145" cy="74" r="9" fill="#fce7f3" />
          <circle cx="215" cy="68" r="8" fill="#fbcfe8" />
          <circle cx="172" cy="128" r="7" fill="#f9a8d4" />
          <circle cx="268" cy="88" r="6" fill="#7dd3fc" />
          <circle cx="110" cy="155" r="6.5" fill="#fce7f3" />
        </svg>

        <svg
          className="absolute -top-4 -right-6 w-[400px] h-[320px] canopy-right opacity-85 pointer-events-none"
          viewBox="0 0 460 360"
        >
          <defs>
            <radialGradient id="sakuraClusterRight" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="40%" stopColor="#fbcfe8" stopOpacity="0.9" />
              <stop offset="75%" stopColor="#f472b6" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#db2777" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx="365" cy="68" rx="105" ry="58" fill="url(#sakuraClusterRight)" />
          <ellipse cx="255" cy="55" rx="115" ry="50" fill="url(#sakuraClusterRight)" />
          <ellipse cx="390" cy="150" rx="90" ry="52" fill="url(#sakuraClusterRight)" />
          <ellipse cx="290" cy="125" rx="95" ry="46" fill="url(#sakuraClusterRight)" />
          <ellipse cx="175" cy="85" rx="80" ry="40" fill="url(#cyanSakuraGlow)" />
          <path d="M470,15 Q360,40 265,78 T135,95" fill="none" stroke="#2b0f30" strokeWidth="7.5" strokeLinecap="round" />
          <path d="M380,38 Q325,95 268,142" fill="none" stroke="#2b0f30" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M470,105 Q395,132 335,178" fill="none" stroke="#2b0f30" strokeWidth="5" strokeLinecap="round" />
          <circle cx="355" cy="62" r="8" fill="#ffffff" />
          <circle cx="290" cy="76" r="9.5" fill="#fce7f3" />
          <circle cx="220" cy="72" r="8" fill="#fbcfe8" />
          <circle cx="272" cy="136" r="7.5" fill="#f9a8d4" />
          <circle cx="175" cy="90" r="6" fill="#7dd3fc" />
          <circle cx="342" cy="168" r="7" fill="#fce7f3" />
        </svg>

        {/* Distant Mountain Silhouette & Torii Sanctuary Horizon */}
        <svg
          className="absolute bottom-0 inset-x-0 w-full h-32 opacity-45 pointer-events-none"
          viewBox="0 0 1440 160"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="horizonMist" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(236,72,153,0.28)" />
              <stop offset="50%" stopColor="rgba(56,189,248,0.24)" />
              <stop offset="100%" stopColor="rgba(236,72,153,0.28)" />
            </linearGradient>
          </defs>
          <path d="M0,160 L0,105 Q220,45 450,95 T920,75 T1440,95 L1440,160 Z" fill="#09061e" />
          <path d="M0,160 L0,125 Q360,80 720,118 T1440,110 L1440,160 Z" fill="url(#horizonMist)" />
          <g transform="translate(115, 62) scale(0.75)" fill="#f472b6" opacity="0.65">
            <path d="M0,12 Q28,4 56,12 L52,17 Q28,10 4,17 Z" />
            <rect x="8" y="21" width="40" height="4" />
            <rect x="14" y="15" width="4.5" height="36" />
            <rect x="37.5" y="15" width="4.5" height="36" />
          </g>
        </svg>

        {/* 60FPS Shooting Stars & 3D Sakura Petals Canvas (rendered only in non-test mode) */}
        {!isTestMode && motionEnabled && (
          <canvas
            ref={canvasRef}
            id="galaxySakuraCanvas"
            className="fixed inset-0 pointer-events-none z-10"
          />
        )}
      </div>
    );
  },
);
