import { pgEnum } from 'drizzle-orm/pg-core';

// Valores conforme docs/04-modelo-de-dados.md.

// Identidade e acesso
export const platformRole = pgEnum('platform_role', ['USER', 'SUPER']);
export const userStatus = pgEnum('user_status', ['ACTIVE', 'BLOCKED', 'INACTIVE']);
export const sportLevel = pgEnum('sport_level', ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'PRO']);
/** Decisão 68: base para categorias de torneio; `UNDISCLOSED` = prefiro não informar. */
export const gender = pgEnum('gender', ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED']);
export const spaceMemberRole = pgEnum('space_member_role', ['OWNER', 'ADMIN', 'TEACHER']);
export const spaceMemberStatus = pgEnum('space_member_status', ['INVITED', 'ACTIVE', 'REMOVED']);
/** Convite de equipe; o prazo vencido é derivado de `expires_at` (um PENDING vencido ainda pode ser reenviado). */
export const staffInviteStatus = pgEnum('staff_invite_status', ['PENDING', 'ACCEPTED', 'REVOKED']);
/** O doc não lista os valores; o push é via Expo, então só iOS e Android. */
export const devicePlatform = pgEnum('device_platform', ['IOS', 'ANDROID']);

// Espaço
export const spaceStatus = pgEnum('space_status', ['ACTIVE', 'SUSPENDED', 'CLOSED']);
export const attendanceMode = pgEnum('attendance_mode', ['AUTOMATIC', 'MANUAL']);
export const courtStatus = pgEnum('court_status', ['ACTIVE', 'MAINTENANCE', 'INACTIVE']);

// Agenda
export const occupationKind = pgEnum('occupation_kind', [
  'BOOKING',
  'CLASS',
  'TOURNAMENT',
  'BLOCK',
]);

/** O que impediu gerar a sessão da turma: a agenda da quadra ou os professores (decisão 47). */
export const classConflictKind = pgEnum('class_conflict_kind', [
  ...occupationKind.enumValues,
  'TEACHER',
]);

// Aluguel
/** `PENDING_PAYMENT`: segura o horário até o pagamento online (decisão 85). */
export const bookingStatus = pgEnum('booking_status', [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);
export const bookingPaymentStatus = pgEnum('booking_payment_status', [
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
]);
export const bookingSource = pgEnum('booking_source', ['APP', 'DESK', 'RECURRING']);
/** Convites (participante da conta dividida; na Fase 3, membro de dupla). */
export const inviteStatus = pgEnum('invite_status', ['INVITED', 'ACCEPTED', 'DECLINED']);
export const recurringBookingStatus = pgEnum('recurring_booking_status', [
  'PENDING_APPROVAL',
  'ACTIVE',
  'PAUSED',
  'ENDED',
  'REJECTED',
]);
/** Mensalidades (do mensalista; na Fase 2, das assinaturas de aula). */
export const chargeStatus = pgEnum('charge_status', ['PENDING', 'PAID', 'OVERDUE', 'WAIVED']);

// Pagamentos
export const paymentMethod = pgEnum('payment_method', ['PIX', 'CARD', 'CASH', 'OTHER']);
export const payableType = pgEnum('payable_type', [
  'BOOKING',
  'BOOKING_PARTICIPANT',
  'RECURRING_BOOKING_CHARGE',
  'SUBSCRIPTION_CHARGE',
  'TEAM',
]);

/** Canal do registro de pagamento: no espaço ou online pelo app (RN-ONPAY-04). */
export const paymentChannel = pgEnum('payment_channel', ['ON_SITE', 'ONLINE']);

// Pagamento online (decisões 80 a 92). Valores conforme packages/shared/src/online-payments.ts e
// payments.ts.
export const bookingPaymentMode = pgEnum('booking_payment_mode', [
  'ON_SITE',
  'ONLINE_OPTIONAL',
  'ONLINE_REQUIRED',
]);
export const classPaymentMode = pgEnum('class_payment_mode', ['ON_SITE', 'ONLINE_OPTIONAL']);
export const feePayer = pgEnum('fee_payer', ['SPACE', 'PLAYER']);
export const merchantAccountStatus = pgEnum('merchant_account_status', [
  'NOT_STARTED',
  'PENDING',
  'APPROVED',
  'REJECTED',
]);
export const documentType = pgEnum('document_type', ['CPF', 'CNPJ']);
export const payoutDestinationKind = pgEnum('payout_destination_kind', ['BANK_ACCOUNT', 'PIX_KEY']);
export const onlinePaymentMethod = pgEnum('online_payment_method', ['PIX', 'CARD']);
export const onlineChargeStatus = pgEnum('online_charge_status', [
  'PENDING',
  'PAID',
  'EXPIRED',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'CHARGEBACK',
]);
export const onlineRefundKind = pgEnum('online_refund_kind', ['REFUND', 'CHARGEBACK']);
export const onlineRefundStatus = pgEnum('online_refund_status', [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
]);
/** Motivo do estorno (decisões 86 e 96); valores conforme ONLINE_REFUND_REASON_CODES. */
export const onlineRefundReasonCode = pgEnum('online_refund_reason_code', [
  'MANUAL',
  'BOOKING_CANCELLED_BY_PLAYER',
  'BOOKING_CANCELLED_BY_SPACE',
  'ACCOUNT_DELETED',
  'PAID_AFTER_DEADLINE',
  'PAID_AFTER_METHOD_CHANGE',
  'ITEM_ALREADY_PAID',
  'CHARGEBACK',
  'EXTERNAL',
]);
export const chargebackDisputeStatus = pgEnum('chargeback_dispute_status', [
  'AWAITING_RESPONSE',
  'RESPONDED',
  'WON',
  'LOST',
]);
export const ledgerEntryKind = pgEnum('ledger_entry_kind', [
  'SALE',
  'PLATFORM_FEE',
  'REFUND',
  'FEE_REFUND',
  'CHARGEBACK',
  'PAYOUT',
  'ADJUSTMENT',
]);
export const payoutStatus = pgEnum('payout_status', ['SCHEDULED', 'PAID', 'FAILED']);

// Contatos
/** Valores conforme CONTACT_ORIGINS em packages/shared/src/contacts.ts. */
export const contactOrigin = pgEnum('contact_origin', [
  'BOOKING_INVITE_ORGANIZER',
  'BOOKING_INVITE_SELF',
  'DESK_BOOKING',
  'RECURRING_DESK',
]);

// Plataforma (Super)
/** `CANCELLED`: o titular desistiu pelo atendimento e a conta foi reativada (decisão 40). */
export const deletionRequestStatus = pgEnum('deletion_request_status', [
  'PENDING',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
]);
/** `USER`: pedido do titular; `SUPER`: registrado pela equipe (ex.: pedido por e-mail). */
export const deletionRequestSource = pgEnum('deletion_request_source', ['USER', 'SUPER']);

// Aulas
export const classSessionStatus = pgEnum('class_session_status', [
  'SCHEDULED',
  'OPEN',
  'CLOSED',
  'DONE',
  'CANCELLED',
]);
export const attendanceStatus = pgEnum('attendance_status', [
  'CONFIRMED',
  'WAITLIST',
  'CANCELLED',
  'PRESENT',
  'ABSENT',
]);
export const subscriptionStatus = pgEnum('subscription_status', [
  'PENDING_APPROVAL',
  'ACTIVE',
  'PAST_DUE',
  'CANCELLED',
]);
/** `PENDING`: turma pedida, enquanto a assinatura aguarda aprovação (não conta na vaga). */
export const enrollmentStatus = pgEnum('enrollment_status', ['ACTIVE', 'ENDED', 'PENDING']);

// Anúncios (decisões 73 a 79). Valores conforme packages/shared/src/ads.ts; sem `BETTING` nem
// `ALCOHOL` (RN-ADS-01).
export const adAdvertiserKind = pgEnum('ad_advertiser_kind', ['COMPANY', 'SPACE']);
export const adCategory = pgEnum('ad_category', [
  'SPORTING_GOODS',
  'APPAREL',
  'SUPPLEMENTS',
  'FOOD_BEVERAGE',
  'HEALTH',
  'FITNESS',
  'SPORTS_SPACE',
  'EVENTS',
  'SERVICES',
  'OTHER',
]);
export const adPlacement = pgEnum('ad_placement', ['EXPLORE_HERO', 'EXPLORE_FEED']);
export const adCampaignStatus = pgEnum('ad_campaign_status', [
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'ARCHIVED',
]);
export const adDestinationType = pgEnum('ad_destination_type', ['URL', 'WHATSAPP', 'SPACE']);
export const adEventType = pgEnum('ad_event_type', ['IMPRESSION', 'CLICK']);

// Avaliações (decisões 99 a 106). Valores conforme packages/shared/src/reviews.ts.
export const reviewTag = pgEnum('review_tag', [
  'GOOD_COURT',
  'BAD_COURT',
  'GOOD_SERVICE',
  'BAD_SERVICE',
  'CLEAN',
  'DIRTY',
  'GOOD_VALUE',
  'EXPENSIVE',
  'EASY_BOOKING',
  'HARD_BOOKING',
  'GOOD_LIGHTING',
  'BAD_LIGHTING',
  'ON_TIME',
  'DELAYS',
  'GOOD_FACILITIES',
  'POOR_FACILITIES',
]);
/** "Jogou aqui" (reserva) ou "Aluno" (aula), conforme o uso mais recente (RN-REVIEW-01). */
export const reviewAuthorKind = pgEnum('review_author_kind', ['PLAYER', 'STUDENT']);
export const reviewReportReason = pgEnum('review_report_reason', [
  'SPAM',
  'OFFENSIVE',
  'FALSE_INFO',
  'PERSONAL_DATA',
  'OTHER',
]);
export const reviewReportStatus = pgEnum('review_report_status', ['OPEN', 'RESOLVED', 'DISMISSED']);
/** O uso que gerou o pedido de avaliação (RN-REVIEW-02). */
export const reviewPromptSource = pgEnum('review_prompt_source', ['BOOKING', 'CLASS_SESSION']);
