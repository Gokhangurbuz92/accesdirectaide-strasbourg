/**
 * R34 (R33 audit G5): a message attachment the screen offers must fit the hosting's request body (about 4.5 MB): base64 adds a third, so 3 MB — the
 * Coffre's limit — on both sides. Before, 5 MB (6.7 MB encoded) was offered and failed on the hosting.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES, prepareAttachment } from '../../api/_services/message-attachments.js';
import { ATTACHMENT_MAX_BYTES } from '../../src/components/Messaging/MessageAttachments.jsx';
import { MAX_SIZE } from '../../src/lib/fileVaultLimits.js';

const BODY_CAP = 4.5 * 1024 * 1024;
describe('message attachment size', () => {
  it('the server and the screen use the same limit, the Coffre’s', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(MAX_ATTACHMENT_BYTES);
    expect(MAX_ATTACHMENT_BYTES).toBe(MAX_SIZE);
  });
  it('the largest allowed file, base64-encoded in a JSON body, stays under the serverless body cap', () => {
    expect(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4096).toBeLessThan(BODY_CAP);
  });
  it('a file over the limit is refused as too large (413), not as unreadable — at the limit + 1 byte and far above it', () => {
    const pdf = (n) => Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(n - 5)]).toString('base64');
    expect(prepareAttachment({ filename: 'a.pdf', contentBase64: pdf(MAX_ATTACHMENT_BYTES) })).toMatchObject({ ok: true });
    for (const n of [MAX_ATTACHMENT_BYTES + 1, 5 * 1024 * 1024]) expect(prepareAttachment({ filename: 'a.pdf', contentBase64: pdf(n) })).toMatchObject({ ok: false, status: 413, code: 'ATTACHMENT_TOO_LARGE' });
    expect(prepareAttachment({ filename: 'a.pdf', contentBase64: '***' })).toMatchObject({ ok: false, status: 400, code: 'INVALID_ATTACHMENT' });
  });
});
