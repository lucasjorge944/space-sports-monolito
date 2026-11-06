import {
  dismissReviewReportSchema,
  manageReviewPageSchema,
  manageReviewSchema,
  manageReviewSummarySchema,
  moderateReviewSchema,
  myReviewPageSchema,
  myReviewSchema,
  publicReviewPageSchema,
  replyReviewSchema,
  reportReviewSchema,
  reviewEligibilitySchema,
  reviewSummarySchema,
  superReviewDetailSchema,
  superReviewPageSchema,
  superReviewReportPageSchema,
  superReviewSummarySchema,
  upsertReviewSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI das avaliações, a partir dos schemas de @space-sports/shared.

export const reviewSchemas = {
  eligibility: openApiSchema(reviewEligibilitySchema, 'ReviewEligibility', 'output'),
  myReview: openApiSchema(myReviewSchema, 'MyReview', 'output'),
  myReviewPage: openApiSchema(myReviewPageSchema, 'MyReviewPage', 'output'),
  upsert: openApiSchema(upsertReviewSchema, 'UpsertReviewInput', 'input'),
  report: openApiSchema(reportReviewSchema, 'ReportReviewInput', 'input'),
  summary: openApiSchema(reviewSummarySchema, 'ReviewSummary', 'output'),
  publicPage: openApiSchema(publicReviewPageSchema, 'PublicReviewPage', 'output'),
  manageReview: openApiSchema(manageReviewSchema, 'ManageReview', 'output'),
  managePage: openApiSchema(manageReviewPageSchema, 'ManageReviewPage', 'output'),
  manageSummary: openApiSchema(manageReviewSummarySchema, 'ManageReviewSummary', 'output'),
  reply: openApiSchema(replyReviewSchema, 'ReplyReviewInput', 'input'),
  moderate: openApiSchema(moderateReviewSchema, 'ModerateReviewInput', 'input'),
  superPage: openApiSchema(superReviewPageSchema, 'SuperReviewPage', 'output'),
  superDetail: openApiSchema(superReviewDetailSchema, 'SuperReviewDetail', 'output'),
  superReportPage: openApiSchema(superReviewReportPageSchema, 'SuperReviewReportPage', 'output'),
  superSummary: openApiSchema(superReviewSummarySchema, 'SuperReviewSummary', 'output'),
  dismiss: openApiSchema(dismissReviewReportSchema, 'DismissReviewReportInput', 'input'),
};
