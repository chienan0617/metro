/**
 * 品牌資訊：CA STUDIO 標誌（來自工作室原圖）與遊戲名稱。
 */

export const STUDIO_NAME = "CA STUDIO";
export const GAME_TITLE = "捷運路網大亨";
export const GAME_SUBTITLE = "在區域地圖上親手打造你的捷運網絡";

/** CA 幾何字母標誌（原始向量路徑）。 */
export function logoSvg(px: number, options?: { withBackground?: boolean; class?: string }): string {
  const background = options?.withBackground
    ? '<rect width="1254" height="1254" fill="#000000" />'
    : "";
  const className = options?.class ? ` class="${options.class}"` : "";
  return `<svg${className} xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 1254 1254" role="img" aria-label="${STUDIO_NAME}">
  ${background}
  <g fill="currentColor" fill-rule="nonzero">
    <path d="M 663 376
         L 455 376
         C 320 376, 211 485, 211 620
         C 211 753, 308 858, 441 858
         L 542 858
         L 608 758
         L 447 758
         C 371 758, 309 696, 309 620
         C 309 544, 371 481, 447 481
         L 592 481
         Z" />
    <path d="M 740 376
         L 1034 856
         L 921 856
         L 739 562
         L 634 717
         L 509 717
         Z" />
  </g>
</svg>`;
}
