package com.otcc.viewer.model;

import com.fasterxml.jackson.annotation.JsonInclude;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Optional {@code descriptionEx} extension content of {@code batch-meta.json}.
 *
 * <p>The viewer renders it at the end of the Task Note panel according to
 * {@code contentType} (read-only, lazy-loaded, never written into
 * {@code batches-index.json}). Supported content types:</p>
 *
 * <ul>
 *   <li>{@code markDownTable}: {@code plainContent} is Markdown table text (GFM subset:
 *       header + separator + data rows, with {@code \|} escapes and {@code :---:}
 *       alignment); the viewer renders it as an HTML table with search / column sorting /
 *       pagination;</li>
 *   <li>any other value (or absent): rendered as plain text (fallback, no error).</li>
 * </ul>
 *
 * <p>To add a content type: add a parsing pure function to the viewer's
 * {@code public/core.js} and register a renderer in {@code DESC_EX_RENDERERS} in
 * {@code public/app.js}; this model needs no change.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class DescriptionEx {
    /** Content type, e.g. {@code "markDownTable"}; case-insensitive, defaults to plain text. */
    private String contentType;
    /** Content body (Markdown table text or plain text). */
    private String plainContent;
}
