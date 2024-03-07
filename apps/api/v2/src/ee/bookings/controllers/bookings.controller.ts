import { CreateBookingInput } from "@/ee/bookings/inputs/create-booking.input";
import { CreateReccuringBookingInput } from "@/ee/bookings/inputs/create-reccuring-booking.input";
import { GetUser } from "@/modules/auth/decorators/get-user/get-user.decorator";
import { AccessTokenGuard } from "@/modules/auth/guards/access-token/access-token.guard";
import { OAuthFlowService } from "@/modules/oauth-clients/services/oauth-flow.service";
import {
  Controller,
  Post,
  Logger,
  Req,
  InternalServerErrorException,
  Body,
  HttpException,
  Query,
  Get,
  Param,
  UseGuards,
  NotFoundException,
} from "@nestjs/common";
import { User } from "@prisma/client";
import { Request } from "express";
import { NextApiRequest } from "next/types";

import { SUCCESS_STATUS } from "@calcom/platform-constants";
import { getAllUserBookings, getBookingInfo } from "@calcom/platform-libraries";
import {
  handleNewBooking,
  BookingResponse,
  HttpError,
  handleNewRecurringBooking,
  handleInstantMeeting,
} from "@calcom/platform-libraries";
import { ApiResponse } from "@calcom/platform-types";
import { GetBookingsInput } from "@calcom/platform-types/bookings";
import prisma from "@calcom/prisma";

@Controller({
  path: "ee/bookings",
  version: "2",
})
export class BookingsController {
  private readonly logger = new Logger("ee bookings controller");

  constructor(private readonly oAuthFlowService: OAuthFlowService) {}

  @Get("/")
  @UseGuards(AccessTokenGuard)
  async getBookings(
    @GetUser() user: User,
    @Query() queryParams: GetBookingsInput
  ): Promise<ApiResponse<unknown>> {
    // at the moment we only want to return data in the format of the webapp
    // maybe in future when we need to return a different format we can pass in
    // for=atom in query params like we do for schedules
    const { filters, cursor, limit } = queryParams;
    const bookings = await getAllUserBookings({
      bookingListingByStatus: filters.status,
      skip: cursor ?? 0,
      take: limit ?? 10,
      filters: filters,
      ctx: { user: { email: user.email, id: user.id }, prisma: prisma },
    });

    return {
      status: SUCCESS_STATUS,
      data: bookings,
    };
  }

  @Get("/:bookingUid")
  @UseGuards(AccessTokenGuard)
  async getBooking(@Param("bookingUid") bookingUid: string): Promise<ApiResponse<unknown>> {
    const { bookingInfo } = await getBookingInfo(bookingUid);

    if (!bookingInfo) {
      throw new NotFoundException(`Booking with UID=${bookingUid} does not exist.`);
    }

    return {
      status: SUCCESS_STATUS,
      data: bookingInfo,
    };
  }

  @Post("/")
  async createBooking(
    @Req() req: Request & { userId?: number },
    @Body() _: CreateBookingInput
  ): Promise<ApiResponse<unknown>> {
    req.userId = await this.getOwnerId(req);
    try {
      const booking = await handleNewBooking(req as unknown as NextApiRequest & { userId?: number });
      return {
        status: SUCCESS_STATUS,
        data: booking,
      };
    } catch (err) {
      handleBookingErrors(err);
    }
    throw new InternalServerErrorException("Could not create booking.");
  }

  @Post("/reccuring")
  async createReccuringBooking(
    @Req() req: Request & { userId?: number },
    @Body() _: CreateReccuringBookingInput[]
  ): Promise<ApiResponse<BookingResponse[]>> {
    req.userId = await this.getOwnerId(req);
    try {
      const createdBookings: BookingResponse[] = await handleNewRecurringBooking(
        req as unknown as NextApiRequest & { userId?: number }
      );
      return {
        status: SUCCESS_STATUS,
        data: createdBookings,
      };
    } catch (err) {
      handleBookingErrors(err, "recurring");
    }
    throw new InternalServerErrorException("Could not create recurring booking.");
  }

  @Post("/instant")
  async createInstantBooking(
    @Req() req: Request & { userId?: number },
    @Body() _: CreateBookingInput
  ): Promise<ApiResponse<Awaited<ReturnType<typeof handleInstantMeeting>>>> {
    req.userId = await this.getOwnerId(req);
    try {
      const instantMeeting = await handleInstantMeeting(
        req as unknown as NextApiRequest & { userId?: number }
      );
      return {
        status: SUCCESS_STATUS,
        data: instantMeeting,
      };
    } catch (err) {
      handleBookingErrors(err, "instant");
    }
    throw new InternalServerErrorException("Could not create instant booking.");
  }

  async getOwnerId(req: Request): Promise<number | undefined> {
    try {
      const accessToken = req.get("Authorization")?.replace("Bearer ", "");
      if (accessToken) {
        return this.oAuthFlowService.getOwnerId(accessToken);
      }
    } catch (err) {
      this.logger.error(err);
    }
  }
}

function handleBookingErrors(err: Error | HttpError | unknown, type?: "recurring" | `instant`): void {
  const errMsg = `Error while creating ${type ? type + " " : ""}booking.`;
  if (err instanceof HttpError) {
    const httpError = err as HttpError;
    throw new HttpException(httpError?.message ?? errMsg, httpError?.statusCode ?? 500);
  }

  if (err instanceof Error) {
    const error = err as Error;
    throw new InternalServerErrorException(error?.message ?? errMsg);
  }

  throw new InternalServerErrorException(errMsg);
}
