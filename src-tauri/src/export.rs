//! Markdown to HTML for export and printing, following GitHub's rendering.

use comrak::{markdown_to_html, Options};

/// Render GitHub-flavoured markdown. Raw HTML (e.g. `<details>`, `<kbd>`) is kept;
/// the frontend sanitizes the result (`src/export.ts`) before using it.
pub fn render(markdown: &str) -> String {
    let mut options = Options::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.alerts = true;
    options.extension.header_id_prefix = Some(String::new()); // heading anchors, as on GitHub
    options.render.r#unsafe = true;
    options.render.github_pre_lang = true;
    options.render.tasklist_classes = true; // class="task-list-item" for styling
    markdown_to_html(markdown, &options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_github_features() {
        let html = render("# Title\n\n| a |\n|---|\n| 1 |\n\n- [x] done\n\n~~gone~~ https://x.y\n");
        assert!(html.contains("<h1><a inert href=\"#title\"") || html.contains("id=\"title\""), "{html}");
        assert!(html.contains("<table>"), "{html}");
        assert!(html.contains("type=\"checkbox\""), "{html}");
        assert!(html.contains("<del>gone</del>"), "{html}");
        assert!(html.contains("<a href=\"https://x.y\">"), "{html}");
    }

    #[test]
    fn renders_alerts_and_code_languages() {
        let html = render("> [!WARNING]\n> Careful.\n\n```rust\nfn main() {}\n```\n");
        assert!(html.contains("markdown-alert-warning"), "{html}");
        assert!(html.contains("<pre lang=\"rust\">"), "{html}");
    }

    #[test]
    fn keeps_raw_html_with_markdown_inside() {
        let html = render("<details>\n<summary>More</summary>\n\n**Body**\n\n</details>\n");
        assert!(html.contains("<details>") && html.contains("<summary>More</summary>"), "{html}");
        assert!(html.contains("<strong>Body</strong>"), "{html}");
    }
}
