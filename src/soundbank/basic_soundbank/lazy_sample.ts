import { BasicSample } from "./basic_sample";
import { SpessaLog } from "../../utils/loggin";
import { ConsoleColors } from "../../utils/other";
import type { SampleType } from "../enums";

/**
 * A sample whose audio data is loaded on demand (network-lazy soundfonts).
 *
 * Parsed from a "headers-only" soundfont (the `smpl` chunk is empty, cf.
 * `meta.<hash>.sf3`): it knows its identity (`sampleId`), its byte range inside
 * the full `.sf3` (`byteStart`/`byteLength`, relative to the start of the `smpl`
 * data), and its parameters — but holds no audio until injected.
 *
 * Audio is injected later via the inherited `setCompressedData()` (SF3/vorbis).
 * Until then `isResident` is false and the synth skips voices that use it
 * (see `getVoicesForPreset`), so playing a not-yet-loaded preset is silent, not
 * a crash.
 */
export class LazySample extends BasicSample {
    /**
     * Stable identity within the bank: index into `BasicSoundBank.samples`.
     * Consistent across parses of the same file (used to address injections).
     */
    public readonly sampleId: number;

    /**
     * Byte offset of this sample's data, relative to the start of the `smpl`
     * chunk data. Absolute offset in the full `.sf3` = `smplByteOffset + byteStart`.
     */
    public readonly byteStart: number;

    /**
     * Byte length of this sample's data in the full `.sf3`.
     */
    public readonly byteLength: number;

    /**
     * Whether the data is vorbis-compressed (SF3). Lazy loading targets SF3.
     */
    public readonly compressed: boolean;

    /**
     * Linked sample index for resolving stereo links (mirrors SoundFontSample).
     */
    public linkedSampleIndex: number;

    public constructor(
        sampleName: string,
        sampleRate: number,
        originalKey: number,
        pitchCorrection: number,
        sampleType: SampleType,
        loopStart: number,
        loopEnd: number,
        sampleId: number,
        byteStart: number,
        byteLength: number,
        compressed: boolean,
        linkedSampleIndex: number
    ) {
        super(
            sampleName,
            sampleRate,
            originalKey,
            pitchCorrection,
            sampleType,
            loopStart,
            loopEnd
        );
        // Not overridden data: the file copy can still be written back unchanged.
        this.dataOverridden = false;
        this.sampleId = sampleId;
        this.byteStart = byteStart;
        this.byteLength = byteLength;
        this.compressed = compressed;
        this.linkedSampleIndex = linkedSampleIndex;
    }

    /**
     * Whether the audio data has been injected (resident in memory).
     */
    public get isResident(): boolean {
        return this.isCompressed || this.audioData !== undefined;
    }

    /**
     * Resolves the stereo link from a samples array (mirrors SoundFontSample).
     */
    public getLinkedSample(samplesArray: BasicSample[]) {
        if (this.linkedSample || !this.isLinked) {
            return;
        }
        const linked = samplesArray[this.linkedSampleIndex];
        if (linked && !linked.linkedSample) {
            this.setLinkedSample(linked, this.sampleType);
        } else {
            SpessaLog.info(
                `%cInvalid linked sample for ${this.name}. Setting to mono.`,
                ConsoleColors.warn
            );
            this.unlinkSample();
        }
    }
}
