import { Duration, Effect, Schedule, Stream } from "effect";
import type { PeekResult } from "../receipt.js";
import { isTerminal } from "../receipt.js";

export interface WatchOptions {
  readonly interval?: Duration.Input;
}

export interface WaitOptions<A, E> {
  readonly filter?: (result: PeekResult<A, E>) => boolean;
  // eslint-disable-next-line typescript-eslint/no-explicit-any -- Schedule keeps its output open.
  readonly schedule?: Schedule.Schedule<any, unknown>;
}

const equals = <A, E>(left: PeekResult<A, E>, right: PeekResult<A, E>): boolean => {
  if (left._tag !== right._tag) return false;
  if (left._tag === "Success" && right._tag === "Success") return left.value === right.value;
  if (left._tag === "Failure" && right._tag === "Failure") return left.error === right.error;
  if (left._tag === "Defect" && right._tag === "Defect") return left.cause === right.cause;
  return true;
};

export const watch = <A, E, PollError, Requirements>(
  poll: Effect.Effect<PeekResult<A, E>, PollError, Requirements>,
  options?: WatchOptions,
): Stream.Stream<PeekResult<A, E>, PollError, Requirements> => {
  const interval = options?.interval ?? Duration.millis(200);
  return Stream.fromEffectSchedule(poll, Schedule.spaced(interval)).pipe(
    Stream.changesWith(equals),
    Stream.takeUntil(isTerminal),
  );
};

/* eslint-disable-next-line typescript-eslint/no-explicit-any -- Schedule types are open. */
const defaultWaitSchedule: Schedule.Schedule<any, unknown> = Schedule.spaced("200 millis");

/* oxlint-disable effect/noAs -- Schedule input variance cannot preserve the PeekResult input through the open user schedule type. */
export const waitFor = <A, E, PollError, Requirements>(
  poll: Effect.Effect<PeekResult<A, E>, PollError, Requirements>,
  options?: WaitOptions<A, E>,
): Effect.Effect<PeekResult<A, E>, PollError, Requirements> => {
  const filter = options?.filter ?? isTerminal;
  const schedule = options?.schedule ?? defaultWaitSchedule;
  return poll.pipe(
    Effect.repeat({
      // eslint-disable-next-line typescript-eslint/no-explicit-any -- User schedules keep their output open.
      schedule: schedule as Schedule.Schedule<any, PeekResult<A, E>>,
      while: (result) => !filter(result),
    }),
  );
};
/* oxlint-enable effect/noAs */
