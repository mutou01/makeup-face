# Subsystem design references

- [桌面启动](desktop.md)：当前窗口、构建与验收。
- [真人照片口红试妆](lipstick-preview.md)：本机模型、唇区边界和颜色叠加。
- [双颊腮红](blush-preview.md)：脸颊定位和图层独立性。
- [上眼睑眼影](eyeshadow-preview.md)：双眼定位、眼睑和眉毛保护边界。
- [妆容推荐](recommendations.md)：本地预设、排序和试妆入口。
- [本机项目](project-workspace.md)：单照片项目、保存与恢复。
- [照片质量门禁](face-quality.md)：取景、头部姿态和重拍提示。
- [日志与供应商](foundation.md)：日志设计与供应商边界。
- [AI 解释](ai-explanation.md)：本机设置、密钥管理、按需请求与失败回退。

These pages describe what each part of the project is responsible for, how it
runs, what state it keeps, and the contracts it keeps with its callers. Start
with the page for the subsystem you are about to change, then follow its source
links to verify the implementation you are about to alter.

A subsystem can span several modules, packages or processes. Its page describes
the behaviour those parts provide together; it does not need to list every
function, and it does not need to be in one directory.

## Add a reference

Copy [`_template.md`](_template.md) and fill it in. A reference is worth
writing when a subsystem has behaviour that reading its source will not explain
in one sitting: contracts between parts, state that outlives a call, failure
behaviour, or a compatibility rule that is easy to break by accident.

Include:

- what it is responsible for, and what it is deliberately not;
- the source of truth — which file, table or setting decides its behaviour,
  named as a _source of truth_, so a reader knows where to look when the page
  and the code disagree;
- the main runtime paths, in the order they happen;
- the state it keeps and the transitions it allows;
- the constraints and the failure behaviour;
- the commands that verify it.

Leave out anything that a signature already says. Explain what a signature
cannot: what a field means, what its absence means, what must hold before a
call, what happens when it is called anyway.

## Maintain a reference

**Update the owning reference in the same change** when a change alters a
documented responsibility, interface, state transition, runtime path,
compatibility rule or failure behaviour. An internal refactor that preserves
those contracts needs no prose change.

Keep each fact in one reference, and link to it from the agent instructions and
from other pages rather than restating it. Link to files and named symbols
rather than copying implementation details that change often.

Document current behaviour separately from proposed changes. A proposal belongs
in its issue or its change description, not in the reference.

## Describe a change's semantic effect

For each affected subsystem, explain the observable change: what triggers it,
and what the behaviour was before and after. Include changes to interfaces,
state, compatibility and failure behaviour where they apply. Link the reference,
the implementation and the evidence.

For example, a change to how a cache is invalidated should say which condition
triggers the invalidation, which implementation served reads before and after,
and which test exercises that transition.

This is the author's own account. A reviewer verifies it against the diff and
the surrounding code; it is not a proven compatibility verdict.

## Review a change

1. Identify the affected subsystem and the actual runtime path, including which
   part owns the behaviour.
2. Compare the claimed before-and-after behaviour against the code at both ends
   of the change. Trace callers and state transitions beyond the changed lines.
3. Check that changed contracts appear in the owning reference, and that its
   source links still resolve.
4. Check that the cited tests or runtime evidence actually exercise the claimed
   behaviour. Report the checks that were not run.

A documentation update on its own does not prove an implementation. Tests and
runtime evidence remain necessary for any change in behaviour.
