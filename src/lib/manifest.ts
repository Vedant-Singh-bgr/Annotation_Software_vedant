// Parser for the upload platform's session manifest.json.
// Layout produced by kosha-upload verify.py:
//   { schema_version, session_id, session_hash, tenant_id, worksite_id,
//     worker_id, data_type, assets: [{ logical_path, asset_id, size_bytes,
//     content_type, checksum_sha256, r2_object_key, etag }], ... }

export type ManifestAsset = {
  logicalPath: string;
  sha256: string;
  r2BlobKey: string;
  sizeBytes: number | null;
  contentType: string | null;
};

export type ParsedManifest = {
  sessionId: string;
  sessionHash: string | null;
  tenantId: string | null;
  worksiteId: string | null;
  workerId: string | null;
  dataType: string | null;
  totalBytes: number;
  segments: ManifestAsset[]; // ordered by logical_path
};

const MCAP_EXT = /\.mcap$/i;

export function parseManifest(
  raw: unknown,
  opts: { onlyMcap?: boolean } = {},
): ParsedManifest {
  if (!raw || typeof raw !== "object") throw new Error("Manifest is not an object.");
  const m = raw as Record<string, any>;

  const sessionId = String(m.session_id ?? "").trim();
  if (!sessionId) throw new Error("Manifest is missing session_id.");
  if (!Array.isArray(m.assets)) throw new Error("Manifest is missing an assets array.");

  let assets: ManifestAsset[] = m.assets.map((a: any, i: number) => {
    const logicalPath = String(a?.logical_path ?? "").trim();
    const sha256 = String(a?.checksum_sha256 ?? "").trim().toLowerCase();
    const r2BlobKey = String(a?.r2_object_key ?? "").trim();
    if (!logicalPath) throw new Error(`Asset #${i} is missing logical_path.`);
    if (!r2BlobKey) throw new Error(`Asset '${logicalPath}' is missing r2_object_key.`);
    return {
      logicalPath,
      sha256,
      r2BlobKey,
      sizeBytes: Number.isFinite(a?.size_bytes) ? Number(a.size_bytes) : null,
      contentType: a?.content_type ? String(a.content_type) : null,
    };
  });

  // The annotatable stream is the MCAP video; sidecars (json/yaml/calib) are
  // provenance only. Filtering keeps the segment list to the 4-min video chunks.
  if (opts.onlyMcap) {
    const mcap = assets.filter((a) => MCAP_EXT.test(a.logicalPath));
    if (mcap.length > 0) assets = mcap;
  }

  // Deterministic order = the session timeline (segments are named ..._004, _005…).
  assets.sort((a, b) => a.logicalPath.localeCompare(b.logicalPath, undefined, { numeric: true }));

  return {
    sessionId,
    sessionHash: m.session_hash ? String(m.session_hash) : null,
    tenantId: m.tenant_id ? String(m.tenant_id) : null,
    worksiteId: m.worksite_id ? String(m.worksite_id) : null,
    workerId: m.worker_id ? String(m.worker_id) : null,
    dataType: m.data_type ? String(m.data_type) : null,
    totalBytes: Number.isFinite(m.total_bytes) ? Number(m.total_bytes) : 0,
    segments: assets,
  };
}
