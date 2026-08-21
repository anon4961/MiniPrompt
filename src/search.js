/**
 * Mini Prompt - 검색 / 필터 로직 (순수 함수)
 *
 * 정규식은 지원하지 않습니다 (오타 시 예외·성능 위험).
 * 대소문자 무시 부분 문자열 매칭만 사용합니다.
 */

import { TAG_FILTER_ALL, TAG_FILTER_UNTAGGED } from './constants.js';

/**
 * 검색어 정규화
 */
function norm(str) {
    return String(str ?? '').toLowerCase();
}

/**
 * 태그 필터 + 이름 검색어로 세트 배열 필터링
 * @param {object[]} sets
 * @param {string} tagFilter - TAG_FILTER_ALL | TAG_FILTER_UNTAGGED | 태그명
 * @param {string} nameQuery
 * @returns {object[]}
 */
export function filterSets(sets, tagFilter = TAG_FILTER_ALL, nameQuery = '') {
    const q = norm(nameQuery).trim();
    return (sets || []).filter(s => {
        if (!s) return false;

        // 태그 필터
        if (tagFilter === TAG_FILTER_UNTAGGED) {
            if (Array.isArray(s.tags) && s.tags.length > 0) return false;
        } else if (tagFilter && tagFilter !== TAG_FILTER_ALL) {
            if (!Array.isArray(s.tags) || !s.tags.includes(tagFilter)) return false;
        }

        // 이름 검색
        if (q && !norm(s.name).includes(q)) return false;

        return true;
    });
}

/**
 * 매칭 위치 주변을 잘라 스니펫 생성
 * @param {string} text
 * @param {string} query
 * @param {number} pad - 앞뒤 여유 글자 수
 * @returns {{before: string, match: string, after: string} | null}
 */
function makeSnippet(text, query, pad = 30) {
    const src = String(text ?? '');
    const q = String(query ?? '');
    if (!q) return null;
    const idx = norm(src).indexOf(norm(q));
    if (idx === -1) return null;

    const start = Math.max(0, idx - pad);
    const end = Math.min(src.length, idx + q.length + pad);
    return {
        before: (start > 0 ? '…' : '') + src.slice(start, idx),
        match: src.slice(idx, idx + q.length),
        after: src.slice(idx + q.length, end) + (end < src.length ? '…' : ''),
    };
}

/**
 * 전체 세트를 대상으로 통합 검색
 *
 * @param {object[]} sets - 전체 세트 배열
 * @param {string} query - 검색어
 * @param {object} opts
 * @param {boolean} opts.searchNames    - 세트 이름 검색
 * @param {boolean} opts.searchContent  - 슬롯 내용 + 슬롯 이름 검색
 * @param {boolean} opts.searchNotes    - 세트 메모 + 슬롯 메모 검색
 * @param {string}  opts.tagFilter      - 태그 필터
 * @param {number}  opts.maxResults     - 결과 상한 (기본 200)
 * @returns {{results: object[], truncated: boolean}}
 *   result: { setId, setName, slotId, slotLabel, field, snippet }
 *   field: 'setName' | 'setNote' | 'slotLabel' | 'slotContent' | 'slotNote'
 */
export function searchAll(sets, query, opts = {}) {
    const {
        searchNames = true,
        searchContent = true,
        searchNotes = true,
        tagFilter = TAG_FILTER_ALL,
        maxResults = 200,
    } = opts;

    const q = String(query ?? '').trim();
    const results = [];
    if (!q) return { results, truncated: false };

    // 태그 필터를 먼저 적용 (이름 검색어는 여기서 쓰지 않음)
    const pool = filterSets(sets, tagFilter, '');
    let truncated = false;

    outer:
    for (const set of pool) {
        if (!set) continue;

        if (searchNames) {
            const sn = makeSnippet(set.name, q, 20);
            if (sn) {
                results.push({
                    setId: set.id, setName: set.name,
                    slotId: null, slotLabel: null,
                    field: 'setName', snippet: sn,
                });
                if (results.length >= maxResults) { truncated = true; break outer; }
            }
        }

        if (searchNotes && set.note) {
            const sn = makeSnippet(set.note, q);
            if (sn) {
                results.push({
                    setId: set.id, setName: set.name,
                    slotId: null, slotLabel: null,
                    field: 'setNote', snippet: sn,
                });
                if (results.length >= maxResults) { truncated = true; break outer; }
            }
        }

        if (!Array.isArray(set.slots)) continue;

        for (const slot of set.slots) {
            if (!slot) continue;

            if (searchContent) {
                const snLabel = makeSnippet(slot.label, q, 20);
                if (snLabel) {
                    results.push({
                        setId: set.id, setName: set.name,
                        slotId: slot.id, slotLabel: slot.label,
                        field: 'slotLabel', snippet: snLabel,
                    });
                    if (results.length >= maxResults) { truncated = true; break outer; }
                }
                const snContent = makeSnippet(slot.content, q);
                if (snContent) {
                    results.push({
                        setId: set.id, setName: set.name,
                        slotId: slot.id, slotLabel: slot.label,
                        field: 'slotContent', snippet: snContent,
                    });
                    if (results.length >= maxResults) { truncated = true; break outer; }
                }
            }

            if (searchNotes && slot.note) {
                const snNote = makeSnippet(slot.note, q);
                if (snNote) {
                    results.push({
                        setId: set.id, setName: set.name,
                        slotId: slot.id, slotLabel: slot.label,
                        field: 'slotNote', snippet: snNote,
                    });
                    if (results.length >= maxResults) { truncated = true; break outer; }
                }
            }
        }
    }

    return { results, truncated };
}

/**
 * 검색 결과 field에 대한 한국어 라벨
 */
export const FIELD_LABELS = {
    setName: '세트 이름',
    setNote: '세트 메모',
    slotLabel: '슬롯 이름',
    slotContent: '슬롯 내용',
    slotNote: '슬롯 메모',
};
