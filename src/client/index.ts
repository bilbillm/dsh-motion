// Both dsh 0.1.x and 0.2.x expose the same Cordis Context to client plugins.
// Using Cordis directly avoids depending on 0.1.x's removed client-runtime package.
import type { Context } from '@deepseek-ai/cordis'
import { MotionRuntime } from '../motion-runtime.ts'

export { MotionPolicy, parseCssDuration } from '../motion-policy.ts'
export type { MotionKind, MotionTiming, MotionTokenSnapshot } from '../motion-policy.ts'
export { SurfaceClassifier, OBSERVED_ATTRIBUTES } from '../surface-classifier.ts'
export type { MotionTrigger, SurfaceIntent } from '../surface-classifier.ts'
export { ThemeCompatibility } from '../theme-compatibility.ts'
export { MotionRuntime, keyframesFor } from '../motion-runtime.ts'
export type { MotionAnimation, MotionAnimator, MotionRuntimeOptions } from '../motion-runtime.ts'

/** No Cordis services are required; dsh.client controls module ordering. */
export const inject: string[] = []

/** Install and dispose the browser runtime with the Cordis plugin fiber. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const runtime = new MotionRuntime({ root: document })
    return runtime.start()
  }, 'dsh-motion: semantic motion runtime')
}
