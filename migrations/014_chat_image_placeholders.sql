-- Pictures sent in chat carry their size and a tiny blurred preview, so the space is held and a soft blur
-- shows while the real picture loads (the same idea as BlurHash, stored as a ~300 byte JPEG).
alter table chat_files add column width int;
alter table chat_files add column height int;
alter table chat_files add column placeholder text;
