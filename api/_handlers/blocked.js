// Block access to dev routes in production
/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default function handler(req, res) {
    res.status(404).json({ error: "Not Found" });
}
