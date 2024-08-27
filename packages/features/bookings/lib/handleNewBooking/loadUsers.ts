import { Prisma } from "@prisma/client";
import type { IncomingMessage } from "http";

import { orgDomainConfig } from "@calcom/features/ee/organizations/lib/orgDomains";
import { HttpError } from "@calcom/lib/http-error";
import logger from "@calcom/lib/logger";
import { UserRepository } from "@calcom/lib/server/repository/user";
import prisma, { userSelect } from "@calcom/prisma";
import { credentialForCalendarServiceSelect } from "@calcom/prisma/selects/credential";

import type { NewBookingEventType } from "./types";

const log = logger.getSubLogger({ prefix: ["[loadUsers]:handleNewBooking "] });

type EventType = Pick<NewBookingEventType, "hosts" | "users" | "id">;

export const loadUsers = async (
  eventType: EventType,
  dynamicUserList: string[],
  req: IncomingMessage,
  roundRobinUsernamePool?: string[] | null
) => {
  try {
    const { currentOrgDomain } = orgDomainConfig(req);

    return eventType.id
      ? await loadUsersByEventType(eventType, roundRobinUsernamePool)
      : await loadDynamicUsers(dynamicUserList, currentOrgDomain);
  } catch (error) {
    if (error instanceof HttpError || error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new HttpError({ statusCode: 400, message: error.message });
    }
    throw new HttpError({ statusCode: 500, message: "Unable to load users" });
  }
};

const loadUsersByEventType = async (
  eventType: EventType,
  roundRobinUsernamePool: string[] | null = []
): Promise<NewBookingEventType["users"]> => {
  const rrUsernamePoolSet = new Set(roundRobinUsernamePool);
  const rrUsernamePoolSize = rrUsernamePoolSet.size;
  const hosts = eventType.hosts || [];

  let users = hosts.reduce((userArray: NewBookingEventType["users"], host) => {
    const { user, isFixed, priority, weight, weightAdjustment } = host;
    if (rrUsernamePoolSize && rrUsernamePoolSize === userArray.length) return userArray;

    const eventTypeUser = {
      ...user,
      isFixed,
      priority,
      weight,
      weightAdjustment,
    };

    if (rrUsernamePoolSize) {
      if (rrUsernamePoolSet.has(eventTypeUser.username)) userArray.push(eventTypeUser);
    } else {
      userArray.push(eventTypeUser);
    }
    return userArray;
  }, []);
  if (users.length) return users;

  // If we fallback to event type users we still need to filter on the rrUsernamePool

  users = eventType.users.reduce((userArray: NewBookingEventType["users"], user) => {
    if (rrUsernamePoolSize === userArray.length) return userArray;

    if (rrUsernamePoolSize) {
      if (user.username && rrUsernamePoolSet.has(user.username)) userArray.push(user);
    } else {
      userArray.push(user);
    }

    return userArray;
  }, [] as NewBookingEventType["users"]);

  return users;
};

const loadDynamicUsers = async (dynamicUserList: string[], currentOrgDomain: string | null) => {
  if (!Array.isArray(dynamicUserList) || dynamicUserList.length === 0) {
    throw new Error("dynamicUserList is not properly defined or empty.");
  }
  return findUsersByUsername({
    usernameList: dynamicUserList,
    orgSlug: !!currentOrgDomain ? currentOrgDomain : null,
  });
};

/**
 * This method is mostly same as the one in UserRepository but it includes a lot more relations which are specific requirement here
 * TODO: Figure out how to keep it in UserRepository and use it here
 */
export const findUsersByUsername = async ({
  usernameList,
  orgSlug,
}: {
  orgSlug: string | null;
  usernameList: string[];
}) => {
  log.debug("findUsersByUsername", { usernameList, orgSlug });
  const { where, profiles } = await UserRepository._getWhereClauseForFindingUsersByUsername({
    orgSlug,
    usernameList,
  });
  return (
    await prisma.user.findMany({
      where,
      select: {
        ...userSelect.select,
        credentials: {
          select: credentialForCalendarServiceSelect,
        },
        metadata: true,
      },
    })
  ).map((user) => {
    const profile = profiles?.find((profile) => profile.user.id === user.id) ?? null;
    return {
      ...user,
      organizationId: profile?.organizationId ?? null,
      profile,
    };
  });
};

export type AwaitedLoadUsers = Awaited<ReturnType<typeof loadUsers>>;
