# API Accessibility and Inclusive Design Guidelines

This document outlines accessibility standards and inclusive design conventions for all backend API endpoints, data models, error formats, and response contracts in InterChangableTrade-Core.

---

## 1. Scope and Intent

For backend and API services, "accessibility" ensures that downstream client interfaces (web, mobile, assistive technologies, screen readers, and automated agents) receive unambiguous semantic data to render accessible experiences without guessing or parsing unstructured prose.

While WCAG 2.1 AA primarily targets visual and DOM-level presentations, backend API contracts directly dictate the underlying semantics (error messaging, status labels, date formats, and numeric units) that make WCAG compliance possible for user interfaces.

---

## 2. Standardized Error Responses

APIs must never rely on plain-text strings or dynamic prose for programmatic handling. Every error response must follow a predictable schema:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "code": "TRADE_LIMIT_EXCEEDED",
  "message": "Requested trade amount exceeds the daily limit for this asset.",
  "details": [
    {
      "field": "amount",
      "issue": "MAX_LIMIT_BREACHED",
      "message": "Amount 5000 exceeds maximum allowable limit of 2500."
    }
  ],
  "timestamp": "2026-10-03T01:50:00.000Z"
}
```

### Requirements:
- **`code`**: Machine-readable, uppercase alphanumeric enum (e.g., `INSUFFICIENT_LIQUIDITY`, `ORDER_NOT_FOUND`).
- **`message`**: Human-readable, descriptive explanation suitable for screen-reader announcements.
- **`details`**: Array of specific per-field validation failures.

---

## 3. Status Enums and Severity Representation

- Never convey status or severity through color or implicit enum codes alone.
- Every state must include a human-readable display label and, where applicable, severity ranking:

```json
{
  "status": "IN_ARBITRATION",
  "statusLabel": "Under review by arbitrator",
  "severity": "high",
  "severityRank": 3
}
```

---

## 4. Units, Currency, and Numerical Scale

- Always explicitly specify currency, token decimals, and scale in responses containing numerical amounts.
- Distinguish between display-formatted strings and raw atomic units (e.g., stroops vs. lumens / USDC):

```json
{
  "amountRaw": "10000000",
  "amountFormatted": "1.0000000",
  "currency": "USDC",
  "decimals": 7
}
```

---

## 5. Timestamps and Time Representations

- All timestamps must follow **ISO 8601** format in UTC with explicit timezone offset (`Z` or `+00:00`).
- Where meaningful for immediate human consumption, provide relative time labels alongside absolute timestamps:

```json
{
  "createdAt": "2026-10-03T01:50:00.000Z",
  "createdAtRelative": "5 minutes ago"
}
```

---

## 6. Pagination and Query Filters

- Endpoints returning collections must return comprehensive pagination metadata and echo back applied filter parameters:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalItems": 154,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "appliedFilters": {
    "status": "ACTIVE",
    "asset": "USDC"
  }
}
```
- Never silently clamp or override user pagination parameters without communicating limits in response metadata.

---

## 7. Notifications and Communication Templates

- Provide plain-text alternatives for all formatted email, push, or webhook notifications.
- Include explicit language tag (`lang: "en"`).
- Avoid emoji-only meaning or visual-only indicators.

---

## 8. OpenAPI and Swagger UI Constraints

- Every controller and endpoint must include:
  - `@ApiOperation({ summary: "...", description: "..." })` with clear purpose.
  - `@ApiResponse()` decorators documenting both success payloads and standard error schemas (`400`, `401`, `404`, `422`, `500`).
  - `@ApiProperty()` examples and descriptions on all DTOs.

---

## 9. API Accessibility Review Checklist

Before opening or approving a pull request with new or updated endpoints, verify:

- [ ] Error responses return structured `code`, human-readable `message`, and per-field `details`.
- [ ] Enums provide descriptive human-readable labels rather than raw database codes alone.
- [ ] Number and currency fields include explicit units, decimals, or currency identifiers.
- [ ] All dates are ISO 8601 UTC strings.
- [ ] List endpoints return standard pagination metadata (`total`, `page`, `hasMore`).
- [ ] OpenAPI documentation is updated with operation summaries, parameter descriptions, and response schemas.

---

## 10. Reporting Accessibility Gaps

If you discover an API endpoint that provides insufficient semantic data or makes accessible client implementation impossible:
1. Open an issue on GitHub tagged with `accessibility` and `area: api`.
2. Reference the specific endpoint route and missing fields.
