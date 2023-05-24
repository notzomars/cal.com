import type { NextApiRequest, NextApiResponse } from "next";

import publicProcedure from "../../../procedures/publicProcedure";
import { router } from "../../../trpc";
import { ZGetScheduleInputSchema } from "./getSchedule.schema";
import { ZReserveSlotInputSchema } from "./reserveSlot.schema";
import { tracer, context } from '../../../../../lib/server/OTEL-initializer';

type SlotsRouterHandlerCache = {
  getSchedule?: typeof import("./getSchedule.handler").getScheduleHandler;
  reserveSlot?: typeof import("./reserveSlot.handler").reserveSlotHandler;
};

const UNSTABLE_HANDLER_CACHE: SlotsRouterHandlerCache = {};

/** This should be called getAvailableSlots */
export const slotsRouter = router({
  getSchedule: publicProcedure.input(ZGetScheduleInputSchema).query(async ({ input, ctx }) => {
    const span = tracer.startSpan('handler', undefined, context.active());
    const ms = Math.floor(Math.random() * 1000);
    span.setAttribute('getSchedule', ms);
    if (!UNSTABLE_HANDLER_CACHE.getSchedule) {
      UNSTABLE_HANDLER_CACHE.getSchedule = await import("./getSchedule.handler").then(
        (mod) => mod.getScheduleHandler
      );
    }

    // Unreachable code but required for type safety
    if (!UNSTABLE_HANDLER_CACHE.getSchedule) {
      throw new Error("Failed to load handler");
    }

    const response = UNSTABLE_HANDLER_CACHE.getSchedule({
      ctx,
      input,
    });

    span.end();
    return response;
  }),
  reserveSlot: publicProcedure.input(ZReserveSlotInputSchema).mutation(async ({ input, ctx }) => {
    if (!UNSTABLE_HANDLER_CACHE.reserveSlot) {
      UNSTABLE_HANDLER_CACHE.reserveSlot = await import("./reserveSlot.handler").then(
        (mod) => mod.reserveSlotHandler
      );
    }

    // Unreachable code but required for type safety
    if (!UNSTABLE_HANDLER_CACHE.reserveSlot) {
      throw new Error("Failed to load handler");
    }

    return UNSTABLE_HANDLER_CACHE.reserveSlot({
      ctx: { ...ctx, req: ctx.req as NextApiRequest, res: ctx.res as NextApiResponse },
      input,
    });
  }),
  // This endpoint has no dependencies, it doesn't need its own file
  removeSelectedSlotMark: publicProcedure.mutation(async ({ ctx }) => {
    const { req, prisma } = ctx;
    const uid = req?.cookies?.uid;
    if (uid) {
      await prisma.selectedSlots.deleteMany({ where: { uid: { equals: uid } } });
    }
    return;
  }),
});
