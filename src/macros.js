/**
 * 미니프롬 - 매크로 치환
 * SillyTavern의 substituteParams를 활용하여 {{char}}, {{user}} 등 처리
 */

import { LOG_PREFIX_DEV } from './constants.js';

/**
 * 매크로 치환 (SillyTavern 표준 함수 호출)
 * @param {string} text - 원본 텍스트
 * @returns {string} - 치환된 텍스트
 */
export function substituteMacros(text) {
    if (!text || typeof text !== 'string') return text || '';

    try {
        // SillyTavern의 전역 substituteParams 사용
        const ctx = SillyTavern?.getContext?.();
        if (ctx && typeof ctx.substituteParams === 'function') {
            return ctx.substituteParams(text);
        }
        // 폴백: 치환 없이 반환
        return text;
    } catch (e) {
        console.warn(`${LOG_PREFIX_DEV} 매크로 치환 실패:`, e);
        return text;
    }
}

/**
 * 토큰 수 추정 (SillyTavern getTokenCount 사용 가능 시 그것을, 아니면 휴리스틱)
 * @param {string} text 
 * @returns {number}
 */
export function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;

    try {
        const ctx = SillyTavern?.getContext?.();
        if (ctx && typeof ctx.getTokenCount === 'function') {
            // 정확한 토큰 카운트
            return ctx.getTokenCount(text);
        }
    } catch (e) {
        // fall through
    }

    // 휴리스틱: 한글 ~2자/토큰, 영문 ~4자/토큰 → 평균 3자/토큰
    return Math.ceil(text.length / 3);
}
