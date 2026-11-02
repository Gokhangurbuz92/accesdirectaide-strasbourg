/**
 * R34 (R33 audit G5): a message attachment the screen offers must fit the hosting's request body (about 4.5 MB): base64 adds a third, so 3 MB — the
 * Coffre's limit — on both sides. Before, 5 MB (6.7 MB encoded) was offered and failed on the hosting.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '../../api/_services/message-attachments.js';
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
});
