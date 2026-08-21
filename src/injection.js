/**
 * Mini Prompt - 프롬프트 주입 엔진 (v2: binding 기반)
 * CHAT_COMPLETION_PROMPT_READY 이벤트를 후킹하여 messages 배열에 직접 주입
 */

import { eventSource, event_types } from '../../../../../script.js';
import { LOG_PREFIX_DEV } from './constants.js';
import {
    getSettings,
    getCurrentCharacterKey,
    getCurrentChatKey,
    getBindings,
    getSet,
} from './storage.js';
import { substituteMacros } from './macros.js';

let _injectionListener = null;

/**
 * 활성 슬롯 수집
 * 현재 채팅방에 binding된 모든 세트의 enabled 슬롯들 수집
 * 중복 세트(캐릭/채팅 양쪽)는 한 번만 포함 (캐릭터 쪽 우선)
 */
function collectActiveSlots() {
    const settings = getSettings();
    if (!settings.enabled) return [];

    const charKey = getCurrentCharacterKey();
    const chatKey = getCurrentChatKey();
    const slots = [];
    const seenSetIds = new Set();  // 중복 방지

    // 캐릭터 binding 먼저 처리
    if (charKey) {
        const ids = getBindings('character', charKey);
        for (const setId of ids) {
            if (seenSetIds.has(setId)) continue;
            const set = getSet(setId);
            if (!set || !Array.isArray(set.slots)) continue;
            seenSetIds.add(setId);
            for (const slot of set.slots) {
                if (!slot.enabled) continue;
                if (!slot.content) continue;
                slots.push({ ...slot, _scope: 'character', _setName: set.name });
            }
        }
    }

    // 채팅 binding 처리 (캐릭터에 이미 있는 세트는 스킵)
    if (chatKey) {
        const ids = getBindings('chat', chatKey);
        for (const setId of ids) {
            if (seenSetIds.has(setId)) continue;  // 중복 스킵
            const set = getSet(setId);
            if (!set || !Array.isArray(set.slots)) continue;
            seenSetIds.add(setId);
            for (const slot of set.slots) {
                if (!slot.enabled) continue;
                if (!slot.content) continue;
                slots.push({ ...slot, _scope: 'chat', _setName: set.name });
            }
        }
    }

    return slots;
}

/**
 * 슬롯에 "주입 순서 등급" 부여
 * 작은 값 = 더 앞쪽(약한 영향), 큰 값 = 더 뒤쪽(강한 영향)
 *
 * 등급 체계:
 *   0: before_main (가장 앞)
 *   1: after_main (시스템 다음)
 *   2~: in_chat (depth가 큰 값일수록 작은 등급, depth=0이 가장 끝)
 *
 * in_chat의 경우 등급을 (1000 - depth)로 매겨서 큰 depth=작은 등급(앞쪽), depth 0 = 1000(가장 뒤)
 */
function getInjectionRank(slot) {
    if (slot.position === 'before_main') return 0;
    if (slot.position === 'after_main') return 1;
    // in_chat: depth가 클수록 앞쪽
    const depth = Math.max(0, parseInt(slot.depth, 10) || 0);
    return 1000 - depth;  // depth=0 → 1000, depth=10 → 990
}

/**
 * 슬롯 배열을 주입 순서대로 정렬 (안정 정렬: 같은 등급은 원래 순서 유지)
 */
function sortSlotsByInjectionOrder(slots) {
    return slots
        .map((slot, idx) => ({ slot, idx, rank: getInjectionRank(slot) }))
        .sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.idx - b.idx;  // 안정 정렬
        })
        .map(item => item.slot);
}

/**
 * CHAT_COMPLETION_PROMPT_READY 이벤트 핸들러
 */
function onPromptReady(eventData) {
    try {
        if (!eventData || !Array.isArray(eventData.chat)) return;
        if (eventData.dryRun) return;

        const slots = collectActiveSlots();
        if (slots.length === 0) return;

        const messages = eventData.chat;

        for (const slot of slots) {
            const content = substituteMacros(slot.content);
            if (!content) continue;

            const message = {
                role: slot.role || 'system',
                content: content,
            };

            if (slot.position === 'before_main') {
                messages.unshift(message);
            } else if (slot.position === 'after_main') {
                if (messages.length > 0 && messages[0]?.role === 'system') {
                    messages.splice(1, 0, message);
                } else {
                    messages.unshift(message);
                }
            } else {
                // in_chat: depth 만큼 끝에서 역산
                const depth = Math.max(0, parseInt(slot.depth, 10) || 0);
                const insertIdx = Math.max(0, messages.length - depth);
                messages.splice(insertIdx, 0, message);
            }
        }
    } catch (e) {
        console.error(`${LOG_PREFIX_DEV} 주입 중 오류:`, e);
    }
}

export function startInjection() {
    if (_injectionListener) {
        console.warn(`${LOG_PREFIX_DEV} 주입 엔진 이미 실행 중`);
        return;
    }

    const evName = event_types?.CHAT_COMPLETION_PROMPT_READY;
    if (!evName) {
        console.warn(`${LOG_PREFIX_DEV} CHAT_COMPLETION_PROMPT_READY 이벤트를 찾을 수 없음`);
        return;
    }

    _injectionListener = onPromptReady;
    eventSource.on(evName, _injectionListener);
    console.log(`${LOG_PREFIX_DEV} 주입 엔진 시작`);
}

export function stopInjection() {
    if (!_injectionListener) return;

    const evName = event_types?.CHAT_COMPLETION_PROMPT_READY;
    if (evName && typeof eventSource.removeListener === 'function') {
        eventSource.removeListener(evName, _injectionListener);
    }
    _injectionListener = null;
    console.log(`${LOG_PREFIX_DEV} 주입 엔진 중지`);
}

/**
 * 프리뷰용 - 실제 주입 순서대로 정렬해서 반환
 */
export function getPreviewMessages() {
    const slots = collectActiveSlots();
    const sorted = sortSlotsByInjectionOrder(slots);
    return sorted.map(slot => ({
        role: slot.role || 'system',
        content: substituteMacros(slot.content),
        _label: slot.label,
        _position: slot.position,
        _depth: slot.depth,
        _scope: slot._scope,
        _setName: slot._setName,
    }));
}
