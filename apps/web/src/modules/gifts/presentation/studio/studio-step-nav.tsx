"use client";

import { cn } from "@love-memory/ui";
import { useStore } from "zustand";

import { selectStepCompletion } from "./draft-editor-store";
import { useStudio } from "./studio-context";

/** Every step with its position, label and, for template steps, `Đã xong` or `Còn thiếu`. */
export function StudioStepNav({ activeStepId }: Readonly<{ activeStepId: string }>) {
  const { navigation, store } = useStudio();
  const completion = useStore(store, selectStepCompletion);
  const steps = store.getState().context.steps;

  return (
    <nav aria-label="Các bước tạo quà" className="mb-8 overflow-x-auto">
      <ol className="flex min-w-max gap-2">
        {steps.map((step, index) => {
          const active = step.id === activeStepId;
          const complete = completion[step.id];
          return (
            <li key={step.id}>
              <button
                aria-current={active ? "step" : undefined}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none",
                  active ? "bg-rose-600 font-bold text-white" : "bg-white text-stone-600",
                )}
                onClick={() => navigation.openStep(step.id)}
                type="button"
              >
                {index + 1}. {step.label}
                {complete === undefined ? null : (
                  <span
                    className={cn(
                      "ml-2 text-xs",
                      active ? "text-rose-50" : complete ? "text-emerald-700" : "text-amber-700",
                    )}
                  >
                    {complete ? "Đã xong" : "Còn thiếu"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
