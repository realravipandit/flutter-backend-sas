// =========================================
// REPORT PAGINATION
// =========================================
const buildPagination = (page, limit, request, sql) => {
    // --- Convert to Numbers ---
    let safePage = parseInt(page, 10);
    let safeLimit = parseInt(limit, 10);

    // --- Validate Page ---
    if (!Number.isFinite(safePage) || safePage < 1) {
        safePage = 1;
    }

    // --- Validate Limit ---
    if (!Number.isFinite(safeLimit) || safeLimit < 1) {
        safeLimit = 25;
    }

    // --- Maximum Limit ---
    if (safeLimit > 500) {
        safeLimit = 500;
    }

    // --- Calculate Offset ---
    const offset = (safePage - 1) * safeLimit;

    // --- Add SQL Parameters ---
    request.input("offset", sql.Int, offset);
    request.input("limit", sql.Int, safeLimit);

    return {
        page: safePage,
        limit: safeLimit,
        offset
    };
};

module.exports = {
    buildPagination
};