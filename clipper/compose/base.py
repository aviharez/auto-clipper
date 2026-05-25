from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Composition:
    id: str
    title: str = "Untitled draft"
    niche: Optional[str] = None
    target_sec: float = 38.0
    hook_text: Optional[str] = None
    hook_animation: Optional[str] = None
    voiceover_source: Optional[str] = None          # 'upload' | 'kokoro' | None
    voiceover_kokoro_voice: Optional[str] = None
    voiceover_kokoro_text: Optional[str] = None
    captions_mode: str = "script"                   # 'script' | 'transcribe' | 'srt'
    captions_text: Optional[str] = None
    caption_preset: Optional[str] = None
    bed_music_file: Optional[str] = None
    bed_music_gain_db: float = -14.0
    bed_music_duck: int = 1
    watermark_text: Optional[str] = None
    status: str = "draft"
    error: Optional[str] = None
    last_render_path: Optional[str] = None
    last_render_duration: Optional[float] = None
    final_path: Optional[str] = None
    delivery_status: Optional[str] = None
    delivery_url: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""


@dataclass
class Segment:
    id: str
    composition_id: str
    idx: int
    kind: str                                       # 'yt' | 'local' | 'image'
    source_url: Optional[str] = None
    source_file: Optional[str] = None
    label: Optional[str] = None
    trim_in: Optional[float] = None
    trim_out: Optional[float] = None
    duration: Optional[float] = None
    motion: Optional[str] = None                   # 'static'|'slide_lr'|'slide_rl'|'zoom_in'|'zoom_out'
    transition_to_next: str = "cut"
    transition_dur_ms: Optional[int] = None
    transition_sfx_file: Optional[str] = None
    status: str = "pending"
    error: Optional[str] = None


@dataclass
class VoiceRange:
    id: str
    composition_id: str
    segment_idx: int
    start_sec: float
    end_sec: float
    snippet: Optional[str] = None


@dataclass
class SFXDrop:
    id: str
    composition_id: str
    at_sec: float
    file: str
    gain_db: float = -6.0
