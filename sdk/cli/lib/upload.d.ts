export type UploadOpts = {
    apiUrl: string;
    token: string;
    release: string;
    kind: 'dsym' | 'proguard' | 'sourcemap';
    path: string;
    /** Override the stored artifact name (defaults to the filename). */
    name?: string;
};
export declare function uploadArtifact(opts: UploadOpts): Promise<{
    id: string;
}>;
//# sourceMappingURL=upload.d.ts.map