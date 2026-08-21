/**
 * 미니프롬 - 이벤트 후킹
 * 채팅방 이름 변경 감지하여 데이터 자동 마이그레이션
 */

import { eventSource, event_types } from '../../../../../script.js';
import { LOG_PREFIX_DEV } from './constants.js';
import {
    getCurrentCharacterKey,
    getCurrentChatFile,
    migrateChatKey,
} from './storage.js';

// 마지막으로 본 채팅 정보 (이름 변경 감지용)
let _lastSeenCharKey = null;
let _lastSeenChatFile = null;

// 이름 변경 직접 감지용 (renameChatButton 클릭 가로채기)
let _pendingRename = null;

/**
 * 채팅 변경 이벤트 핸들러
 * 같은 캐릭터인데 chatFile만 바뀌었으면 = 이름 변경 가능성
 */
function onChatChanged() {
    try {
        const charKey = getCurrentCharacterKey();
        const chatFile = getCurrentChatFile();

        // pending rename이 있으면 우선 적용
        if (_pendingRename
            && _pendingRename.charKey === charKey
            && _pendingRename.oldChatFile
            && chatFile
            && _pendingRename.oldChatFile !== chatFile) {
            // rename 확정: 데이터 마이그레이션
            const migrated = migrateChatKey(charKey, _pendingRename.oldChatFile, chatFile);
            if (migrated) {
                console.log(`${LOG_PREFIX_DEV} rename 감지 → 데이터 이동 완료`);
            }
            _pendingRename = null;
        }

        _lastSeenCharKey = charKey;
        _lastSeenChatFile = chatFile;
    } catch (e) {
        console.error(`${LOG_PREFIX_DEV} CHAT_CHANGED 처리 오류:`, e);
    }
}

/**
 * rename 버튼 클릭 가로채기
 * SillyTavern UI에서 채팅방 이름 변경 시 호출됨
 */
function setupRenameDetection() {
    // SillyTavern의 채팅방 rename 버튼 셀렉터 (변경될 수 있어 try-catch)
    try {
        $(document).on('click', '#option_rename_chat, .rename_chat_btn', () => {
            try {
                const charKey = getCurrentCharacterKey();
                const chatFile = getCurrentChatFile();
                if (charKey && chatFile) {
                    _pendingRename = {
                        charKey,
                        oldChatFile: chatFile,
                        timestamp: Date.now(),
                    };
                    console.log(`${LOG_PREFIX_DEV} rename 시작 감지: ${charKey} / ${chatFile}`);
                }
            } catch (e) {
                console.error(`${LOG_PREFIX_DEV} rename 감지 오류:`, e);
            }
        });
    } catch (e) {
        console.warn(`${LOG_PREFIX_DEV} rename 감지 셀렉터 등록 실패 (UI가 변경되었을 수 있음)`);
    }

    // 5분 이상 지난 pendingRename은 자동 폐기
    setInterval(() => {
        if (_pendingRename && Date.now() - _pendingRename.timestamp > 5 * 60 * 1000) {
            _pendingRename = null;
        }
    }, 60 * 1000);
}

/**
 * 모든 이벤트 후킹 시작
 */
export function setupEventHooks() {
    if (event_types?.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    }
    setupRenameDetection();

    // 초기 상태 기록
    setTimeout(() => {
        _lastSeenCharKey = getCurrentCharacterKey();
        _lastSeenChatFile = getCurrentChatFile();
    }, 1000);

    console.log(`${LOG_PREFIX_DEV} 이벤트 후킹 완료`);
}
