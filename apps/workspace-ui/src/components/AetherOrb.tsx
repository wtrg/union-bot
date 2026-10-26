// Antigravity supplied the component through Union Bot; audited for motion and cleanup.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import "./AetherOrb.css";

export type AetherOrbState = "idle" | "thinking" | "completed" | "blocked";
const LABELS = { idle: "Chưa có lượt", thinking: "Nhóm đang làm việc", completed: "Lượt đã hoàn tất", blocked: "Lượt cần kiểm tra" };

export const AetherOrb = memo(function AetherOrb({ state = "idle", motionEnabled = true }: { state?: AetherOrbState; motionEnabled?: boolean }) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const enabled = motionEnabled && !reduced;
  const resetTilt = useCallback(() => {
    rootRef.current?.style.setProperty("--orb-rx", "0deg");
    rootRef.current?.style.setProperty("--orb-ry", "0deg");
  }, []);
  useEffect(() => {
    if (!enabled) {
      resetTilt();
      rootRef.current?.classList.remove("ub-aether-poked");
    }
  }, [enabled, resetTilt]);
  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!enabled || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - .5;
    const y = (e.clientY - rect.top) / rect.height - .5;
    rootRef.current.style.setProperty("--orb-rx", `${(-y * 36).toFixed(1)}deg`);
    rootRef.current.style.setProperty("--orb-ry", `${(x * 44).toFixed(1)}deg`);
  };
  return (
    <button ref={rootRef} type="button" className="ub-aether-root" data-state={state} data-motion={enabled}
      aria-label={`Chạm tinh linh Aether · ${LABELS[state]}`} title={`Chạm để chào · ${LABELS[state]}`}
      onPointerMove={handlePointerMove} onPointerLeave={resetTilt}
      onClick={e => {
        if (!enabled) return;
        e.currentTarget.classList.remove("ub-aether-poked");
        void e.currentTarget.offsetWidth;
        e.currentTarget.classList.add("ub-aether-poked");
      }}
      onAnimationEnd={e => { if (e.animationName === "ub-aether-boing") rootRef.current?.classList.remove("ub-aether-poked"); }}>
      <span className="ub-aether-stage" aria-hidden="true">
        <span className="ub-aether-float">
          <span className="ub-aether-ring ring-1" /><span className="ub-aether-ring ring-2" />
          <span className="ub-aether-body">
            <span className="ub-aether-core" />
            <span className="ub-aether-face"><span className="ub-aether-eye" /><span className="ub-aether-eye" /></span>
            <span className="ub-aether-cheeks" />
          </span>
          <span className="ub-aether-spark spark-1">✦</span><span className="ub-aether-spark spark-2">✧</span>
        </span>
      </span>
    </button>
  );
});
