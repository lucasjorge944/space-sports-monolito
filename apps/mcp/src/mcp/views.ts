import type {
  MyClassSessionDetail,
  MyClassSessionsResponseItemsItem,
  PlayerBookingDetailDto,
  PlayerBookingDto,
  PublicSpace,
  SpaceCard,
} from '@space-sports/api-client/dist/fetch.js';
import { money } from '../shared/money.js';
import { toLocal, weekdayName } from '../shared/time.js';
import {
  ATTENDANCE_BLOCKED,
  ATTENDANCE_STATUS,
  BOOKING_PAYMENT_STATUS,
  BOOKING_STATUS,
  CANCEL_REASON,
  CLASS_LEVEL,
  CLASS_SESSION_STATUS,
  firstName,
  label,
  PAYMENT_METHOD,
  SPACE_SERVICE,
} from './labels.js';

/**
 * Saídas mínimas das tools (RN-MCP-05): só o que a conversa precisa, datas locais `YYYY-MM-DD` e
 * `HH:mm`, dinheiro em centavos + BRL. Nada de telefone, e-mail ou documento de outras pessoas
 * (pessoas aparecem pelo primeiro nome); textos do banco seguem como campos de dados.
 */

export const spaceLink = (webUrl: string, slug: string) =>
  `${webUrl}/espacos/${encodeURIComponent(slug)}`;

/** Card da busca. */
export function spaceCardView(card: SpaceCard) {
  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    neighborhood: card.neighborhood,
    city: card.city,
    distanceKm: card.distanceMeters === null ? null : Math.round(card.distanceMeters / 100) / 10,
    sports: card.sports.map((sport) => ({ slug: sport.slug, name: sport.name })),
    pricePerHour: money(card.pricePerHourCents),
    rating: ratingView(card.rating),
    services: card.services.map((service) => label(SPACE_SERVICE, service)),
  };
}

function ratingView(rating: { count: number; average: number | null }) {
  return rating.average === null
    ? { average: null, count: rating.count, label: 'Novo (ainda sem nota pública)' }
    : { average: rating.average, count: rating.count, label: `${rating.average.toFixed(1)} de 5` };
}

/** Formas de pagamento da reserva pelo assistente (decisão 115: cartão nunca pelo chat). */
export function rentalPaymentOptions(space: PublicSpace) {
  const options = space.onlinePayments.rental.options;
  return {
    viaAssistant: options.filter(
      (option): option is 'ON_SITE' | 'ONLINE_PIX' =>
        option === 'ON_SITE' || option === 'ONLINE_PIX',
    ),
    cardOnlyInApp: options.includes('ONLINE_CARD'),
  };
}

/** Página do espaço: só o que estiver preenchido; nulo = o espaço não informou. */
export function spaceView(space: PublicSpace, webUrl: string) {
  const payments = rentalPaymentOptions(space);
  return {
    id: space.id,
    slug: space.slug,
    name: space.name,
    description: space.description,
    address: {
      street: space.address.street,
      number: space.address.number,
      neighborhood: space.address.neighborhood,
      postalCode: space.address.postalCode,
      city: space.address.city.name,
      state: space.address.city.state,
    },
    contact: { phone: space.phone, whatsapp: space.whatsapp, instagram: space.instagram },
    amenities: space.amenities.map((amenity) => amenity.name),
    openingHours: [...space.openingHours]
      .sort((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt))
      .map((hour) => ({
        weekday: weekdayName(hour.weekday),
        opensAt: hour.opensAt,
        closesAt: hour.closesAt,
      })),
    sports: space.sports.map((sport) => ({ slug: sport.slug, name: sport.name })),
    services: space.services.map((service) => label(SPACE_SERVICE, service)),
    courts: space.courts.map((court) => ({
      id: court.id,
      name: court.name,
      covered: court.covered,
      sports: court.sports.map((sport) => ({
        slug: sport.slug,
        name: sport.name,
        maxPlayers: sport.maxPlayers,
      })),
    })),
    rental: {
      pricePerHour: money(space.rental.pricePerHourCents),
      minDurationMin: space.rental.minDurationMin,
      maxDurationMin: space.rental.maxDurationMin,
      minAdvanceMin: space.rental.minAdvanceMin,
      bookingWindowDays: space.rental.windowDays,
      cancellationDeadlineMin: space.rental.cancellationDeadlineMin,
    },
    payment: {
      optionsViaAssistant: payments.viaAssistant,
      cardOnlineOnlyInApp: payments.cardOnlyInApp,
      acceptedAtVenue: space.acceptedPaymentMethods.map((method) => label(PAYMENT_METHOD, method)),
    },
    rating: ratingView(space.rating),
    link: spaceLink(webUrl, space.slug),
  };
}

type AnyBooking = PlayerBookingDto | PlayerBookingDetailDto;

const isDetail = (booking: AnyBooking): booking is PlayerBookingDetailDto =>
  'participants' in booking;

/** Reserva do usuário (lista ou detalhe). */
export function bookingView(booking: AnyBooking, me: string, now: Date) {
  const tz = booking.space.timeZone;
  const start = toLocal(booking.startsAt, tz);
  const end = toLocal(booking.endsAt, tz);
  const youAreOrganizer = booking.organizer.userId === me;
  const cancellable =
    (booking.status === 'CONFIRMED' || booking.status === 'PENDING_PAYMENT') &&
    now < new Date(booking.cancellableUntil);
  const pix = isDetail(booking) ? pendingPix(booking, tz) : null;
  return {
    id: booking.id,
    status: booking.status,
    statusLabel: label(BOOKING_STATUS, booking.status),
    space: { id: booking.space.id, slug: booking.space.slug, name: booking.space.name },
    court: { id: booking.court.id, name: booking.court.name },
    sport: { slug: booking.sport.slug, name: booking.sport.name },
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    durationMin: booking.durationMin,
    peopleCount: booking.peopleCount,
    price: money(booking.priceCents),
    youAreOrganizer,
    organizerFirstName: firstName(booking.organizer.name),
    payment: youAreOrganizer
      ? {
          status: booking.paymentStatus,
          statusLabel: label(BOOKING_PAYMENT_STATUS, booking.paymentStatus),
          paid: booking.paidCents === null ? null : money(booking.paidCents),
          dueAt: booking.paymentDueAt ? toLocal(booking.paymentDueAt, tz) : null,
          pixOpenUntil: booking.openOnlineCharge?.expiresAt
            ? toLocal(booking.openOnlineCharge.expiresAt, tz)
            : null,
          pix,
        }
      : null,
    cancellableUntil: toLocal(booking.cancellableUntil, tz),
    canCancelNow: cancellable,
    cancelledAt: booking.cancelledAt ? toLocal(booking.cancelledAt, tz) : null,
    cancelReason:
      booking.cancelReason && (youAreOrganizer || CANCEL_REASON[booking.cancelReason])
        ? label(CANCEL_REASON, booking.cancelReason)
        : null,
    ...(isDetail(booking)
      ? {
          participants: booking.participants.map((participant) => ({
            firstName: firstName(participant.name),
            isOrganizer: participant.isOrganizer,
            isMe: participant.isMe,
            status: participant.status,
          })),
        }
      : {}),
  };
}

/** Pix copia e cola em aberto (só o organizador recebe `onlinePayment`). */
function pendingPix(booking: PlayerBookingDetailDto, tz: string) {
  const charge = booking.onlinePayment;
  if (charge?.status !== 'PENDING' || !charge.pix) return null;
  return {
    copyPaste: charge.pix.copyPaste,
    amount: money(charge.amountCents),
    expiresAt: toLocal(charge.pix.expiresAt, tz),
  };
}

type AnySession = MyClassSessionsResponseItemsItem | MyClassSessionDetail;

/** Aula do usuário. Os outros alunos confirmados nunca saem (só a contagem). */
export function classSessionView(session: AnySession) {
  const tz = session.space.timeZone;
  const start = toLocal(session.startsAt, tz);
  const end = toLocal(session.endsAt, tz);
  return {
    id: session.id,
    className: session.classGroup.name,
    sport: { slug: session.sport.slug, name: session.sport.name },
    level: label(CLASS_LEVEL, session.level),
    space: { id: session.space.id, slug: session.space.slug, name: session.space.name },
    court: session.court.name,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    status: session.status,
    statusLabel: label(CLASS_SESSION_STATUS, session.status),
    teachers: session.teachers.map((teacher) => firstName(teacher.name)),
    capacity: session.capacity,
    confirmedCount: session.confirmedCount,
    waitlistCount: session.waitlistCount,
    myAttendance: session.myAttendance
      ? {
          status: session.myAttendance.status,
          statusLabel: label(ATTENDANCE_STATUS, session.myAttendance.status),
          waitlistPosition: session.myAttendance.waitlistPosition,
        }
      : null,
    canConfirm: session.canConfirm,
    canWithdraw: session.canWithdraw,
    blockedReason: label(ATTENDANCE_BLOCKED, session.blockedReason),
    withdrawUntil: toLocal(session.cancellableUntil, tz),
    cancelReason: session.cancelReason,
  };
}
