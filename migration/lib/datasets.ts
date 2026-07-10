// Dataset identity: which physical SQLite file/device-scope a --dataset name
// refers to. bertha-archive is one unfiltered stream (andrew-MS-7B86 and
// big-bertha are the SAME physical machine across a hostname rename -- a
// single temporally sequential timeline, confirmed by agent://MigrationDesign:
// andrew-MS-7B86's rows end before big-bertha's begin -- so no device split is
// needed; alias resolution happens at write time via deviceAliases). ron-live
// and ron-demo share one physical file (frontend/prisma/db.sqlite) but are two
// unrelated devices in non-interleaved rowid blocks (confirmed: D2 rows
// 1-8241, big-ron rows 8242+), so each gets its own dataset name, own
// migration checkpoint, and its own deviceName filter -- this is what lets an
// operator import ron-live while deliberately skipping the synthetic ron-demo
// fixture, or vice versa.

export type DatasetName = "bertha-archive" | "ron-live" | "ron-demo";

export const DATASETS: Record<DatasetName, { deviceFilter: string | null }> = {
    "bertha-archive": { deviceFilter: null },
    "ron-live": { deviceFilter: "big-ron" },
    "ron-demo": { deviceFilter: "D2" },
};

export function isDatasetName(value: string): value is DatasetName {
    return value in DATASETS;
}
