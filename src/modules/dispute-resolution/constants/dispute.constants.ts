export const ALLOWED_EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export const MAX_EVIDENCE_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const INITIAL_REVIEW_SLA_HOURS = 24;
export const RESOLUTION_SLA_DAYS = 14;

export const MAX_DISPUTES_PER_USER_PER_MONTH = 5;
export const MIN_DESCRIPTION_LENGTH = 20;
