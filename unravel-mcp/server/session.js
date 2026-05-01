export function createSession() {
    return {
        files: [],
        astRaw: null,
        crossFileRaw: null,
        graph: null,
        projectRoot: null,
        patternsLoaded: false,
        mcpPatternFile: null,
        lastAnalysisHash: null,
        lastAnalysisResult: null,
        diagnosisArchive: [],
        archiveLoaded: false,
        lastSymptom: '',
    };
}

