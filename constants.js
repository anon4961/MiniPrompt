/**
 * Mini Prompt (MiniCustomPrompt)
 * 상수 및 기본값 정의 (v2: 글로벌 세트 풀 구조)
 */

export const EXTENSION_NAME = 'MiniCustomPrompt';
export const EXTENSION_DISPLAY_NAME = 'Mini Prompt';
export const SETTINGS_KEY = 'MiniCustomPrompt';
export const DATA_VERSION = 3;
export const EXPORT_TYPE = 'MiniCustomPrompt';

// 로그 prefix
export const LOG_PREFIX = '[Mini Prompt]';
export const LOG_PREFIX_DEV = '[MiniCustomPrompt]';

// 태그 필터 특수값
export const TAG_FILTER_ALL = '__all__';
export const TAG_FILTER_UNTAGGED = '__untagged__';
export const UNTAGGED_LABEL = '미분류';

// 슬롯 기본값
export const DEFAULT_SLOT = {
    label: '새 슬롯',
    enabled: true,
    content: '',
    note: '',                        // 메모 (주입되지 않음, 사용자 참고용)
    role: 'system',                  // 'system' | 'user' | 'assistant'
    position: 'in_chat',             // 'before_main' | 'after_main' | 'in_chat'
    depth: 0,
    order: 100,
};

// 위치 옵션 (SillyTavern 작가노트와 동일한 라벨)
export const POSITION_LABELS = {
    'before_main': 'Before Main Prompt / Story String',
    'after_main': 'After Main Prompt / Story String',
    'in_chat': 'In-chat @ Depth',
};

// 기본 설정 구조 (v3)
export const DEFAULT_SETTINGS = {
    version: DATA_VERSION,
    enabled: true,                   // 마스터 스위치
    sets: {},                        // 글로벌 세트 풀: { setId: SetObject }
    tags: [],                        // 전역 태그 목록 (순서 유지, 빈 태그도 존재 가능)
    bindings: {                      // 적용 매핑
        characters: {},              // { "avatar.png": ["setId1", "setId2"] }
        chats: {},                   // { "chatKey": ["setId3"] }
    },
    ui: {
        showTokenCount: true,
        confirmBeforeDelete: true,
        showSlotNotes: true,         // 슬롯 메모 입력란 표시 여부
    },
};

/**
 * 빈 세트 생성
 */
export function createEmptySet(name = '새 세트') {
    return {
        id: generateId('set'),
        name: name,
        tags: [],                    // 다중 태그
        note: '',                    // 메모 (주입되지 않음)
        slots: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

/**
 * 빈 슬롯 생성
 */
export function createEmptySlot(label = '새 슬롯') {
    return {
        id: generateId('slot'),
        ...DEFAULT_SLOT,
        label: label,
    };
}

// 고유 ID 생성
export function generateId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// 채팅방 키 합성
export function makeChatKey(charKey, chatFile) {
    if (!charKey || !chatFile) return null;
    return `${charKey}__${chatFile}`;
}
