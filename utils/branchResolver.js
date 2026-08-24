const { sql } = require("../db");

/**
 * Desktop behaviour:
 *
 * No branches created
 *      -> NULL BranchID
 *
 * Branches exist
 *      -> Use selected BranchID
 */
async function resolveBranch(tx, requestedBranchId = null) {

    const result = await new sql.Request(tx).query(`
        SELECT COUNT(*) AS TotalBranches
        FROM tblBranch
    `);

    const totalBranches =
        Number(result.recordset[0].TotalBranches);

    // Desktop stores NULL when there are no branches
    if (totalBranches === 0) {
        return null;
    }

    if (requestedBranchId == null) {
        throw new Error(
            "A branch must be selected."
        );
    }

    const check = await new sql.Request(tx)
        .input("branchId", sql.Int, requestedBranchId)
        .query(`
            SELECT BranchID
            FROM tblBranch
            WHERE BranchID=@branchId
        `);

    if (!check.recordset.length) {
        throw new Error(
            `Branch ${requestedBranchId} does not exist.`
        );
    }

    return requestedBranchId;
}

module.exports = {
    resolveBranch,
};