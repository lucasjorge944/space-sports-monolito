import {
  type CancelBookingDto,
  type CreateBookingDto,
  cancelMyBooking,
  confirmMyClassSession,
  createBooking,
  type GetManageReviewSummaryParams,
  type GetSpaceAvailabilityParams,
  type GetSpaceBookingAnalyticsParams,
  type GetSpaceClassAnalyticsParams,
  type GetSpaceCustomerAnalyticsParams,
  type GetSpaceOccupancyAnalyticsParams,
  type GetSpaceRevenueAnalyticsParams,
  type GetSpaceStatementParams,
  getManageReviewSummary,
  getMyBooking,
  getMyStaffSpaces,
  getMySummary,
  getReceivablesToday,
  getSpaceAvailability,
  getSpaceBookingAnalytics,
  getSpaceBySlug,
  getSpaceClassAnalytics,
  getSpaceClasses,
  getSpaceCustomerAnalytics,
  getSpaceOccupancyAnalytics,
  getSpaceRevenueAnalytics,
  getSpaceStatement,
  getWalletSummary,
  type ListClassGroupsParams,
  type ListManageReviewsParams,
  type ListMyBookingsParams,
  type ListMyClassSessionsParams,
  type ListSpaceBookingsParams,
  listClassGroups,
  listCourts,
  listDelinquents,
  listManageReviews,
  listMyBookings,
  listMyClassSessions,
  listSpaceBookings,
  type SearchSpacesParams,
  type SuperFinanceSummaryParams,
  type SuperGetPlatformAnalyticsParams,
  type SuperGetPlatformRevenueParams,
  type SuperGetSpacesAnalyticsParams,
  type SuperListAuditLogsParams,
  type SuperListReviewReportsParams,
  type SuperListSpacesParams,
  type SuperListUsersParams,
  searchSpaces,
  superFinanceSummary,
  superGetPlatformAnalytics,
  superGetPlatformRevenue,
  superGetSpace,
  superGetSpacesAnalytics,
  superListAuditLogs,
  superListReviewReports,
  superListSpaces,
  superListUsers,
  withdrawMyClassSession,
} from '@space-sports/api-client/dist/fetch.js';

/** Tempo máximo de cada chamada à API (o assistente espera a resposta da tool). */
const API_TIMEOUT_MS = 10_000;

/**
 * Cliente da API para um usuário: as funções do `packages/api-client` com o MESMO Bearer do usuário
 * e `X-Client: mcp` em cada chamada. O MCP não tem banco nem chave de serviço: tudo passa pela API,
 * sob os mesmos guards do app. Os ids que entram em caminhos já chegam validados (uuid/slug) pelas
 * tools, porque as URLs geradas não escapam os parâmetros.
 */
export function createApiClient(token: string) {
  const init = (headers: Record<string, string> = {}): RequestInit => ({
    headers: { Authorization: `Bearer ${token}`, 'X-Client': 'mcp', ...headers },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  return {
    /** Primeiro nome e esportes favoritos (a API não aceita `GET /v1/me` com o token do MCP). */
    getMySummary: () => getMySummary(init()),
    searchSpaces: (params: SearchSpacesParams) => searchSpaces(params, init()),
    getSpace: (slug: string) => getSpaceBySlug(slug, init()),
    getAvailability: (spaceId: string, params: GetSpaceAvailabilityParams) =>
      getSpaceAvailability(spaceId, params, init()),
    getSpaceClasses: (slug: string) => getSpaceClasses(slug, init()),
    listBookings: (params: ListMyBookingsParams) => listMyBookings(params, init()),
    getBooking: (bookingId: string) => getMyBooking(bookingId, init()),
    createBooking: (body: CreateBookingDto, idempotencyKey: string) =>
      createBooking(body, init({ 'Idempotency-Key': idempotencyKey })),
    cancelBooking: (bookingId: string, body: CancelBookingDto) =>
      cancelMyBooking(bookingId, body, init()),
    listClassSessions: (params: ListMyClassSessionsParams) => listMyClassSessions(params, init()),
    confirmAttendance: (sessionId: string) => confirmMyClassSession(sessionId, init()),
    withdrawAttendance: (sessionId: string) => withdrawMyClassSession(sessionId, init()),

    // Gestão em leitura (`manage:read` / `manage:finance:read`; docs/14-mcp.md 8.2 e 8.4). O
    // `spaceId` vem sempre do `GET /v1/me/staff-spaces` (id da própria API), nunca do texto.
    /** Espaços em que o usuário é da equipe, com os papéis e a agenda de hoje. */
    staffSpaces: () => getMyStaffSpaces(init()),
    listSpaceBookings: (spaceId: string, params: ListSpaceBookingsParams) =>
      listSpaceBookings(spaceId, params, init()),
    listCourts: (spaceId: string) => listCourts(spaceId, init()),
    listClassGroups: (spaceId: string, params: ListClassGroupsParams) =>
      listClassGroups(spaceId, params, init()),
    reviewSummary: (spaceId: string, params: GetManageReviewSummaryParams) =>
      getManageReviewSummary(spaceId, params, init()),
    listReviews: (spaceId: string, params: ListManageReviewsParams) =>
      listManageReviews(spaceId, params, init()),
    bookingAnalytics: (spaceId: string, params: GetSpaceBookingAnalyticsParams) =>
      getSpaceBookingAnalytics(spaceId, params, init()),
    occupancyAnalytics: (spaceId: string, params: GetSpaceOccupancyAnalyticsParams) =>
      getSpaceOccupancyAnalytics(spaceId, params, init()),
    classAnalytics: (spaceId: string, params: GetSpaceClassAnalyticsParams) =>
      getSpaceClassAnalytics(spaceId, params, init()),
    customerAnalytics: (spaceId: string, params: GetSpaceCustomerAnalyticsParams) =>
      getSpaceCustomerAnalytics(spaceId, params, init()),
    revenueAnalytics: (spaceId: string, params: GetSpaceRevenueAnalyticsParams) =>
      getSpaceRevenueAnalytics(spaceId, params, init()),
    receivablesToday: (spaceId: string) => getReceivablesToday(spaceId, init()),
    statement: (spaceId: string, params: GetSpaceStatementParams) =>
      getSpaceStatement(spaceId, params, init()),
    delinquents: (spaceId: string) => listDelinquents(spaceId, init()),
    walletSummary: (spaceId: string) => getWalletSummary(spaceId, init()),

    // Plataforma em leitura (`super:read`, recurso do Super; docs/14-mcp.md 8.3). Toda chamada vira
    // uma linha em `audit_logs` na API (`mcp.admin_request`, decisão 123).
    superListSpaces: (params: SuperListSpacesParams) => superListSpaces(params, init()),
    superGetSpace: (spaceId: string) => superGetSpace(spaceId, init()),
    superPlatformAnalytics: (params: SuperGetPlatformAnalyticsParams) =>
      superGetPlatformAnalytics(params, init()),
    superSpacesAnalytics: (params: SuperGetSpacesAnalyticsParams) =>
      superGetSpacesAnalytics(params, init()),
    superFinanceSummary: (params: SuperFinanceSummaryParams) => superFinanceSummary(params, init()),
    superPlatformRevenue: (params: SuperGetPlatformRevenueParams) =>
      superGetPlatformRevenue(params, init()),
    superReviewReports: (params: SuperListReviewReportsParams) =>
      superListReviewReports(params, init()),
    superAuditLogs: (params: SuperListAuditLogsParams) => superListAuditLogs(params, init()),
    superListUsers: (params: SuperListUsersParams) => superListUsers(params, init()),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
