-- Migration 003: member names are plain English first names. The role is shown separately
-- (the app displays Name.Role, e.g. Alex.PM), so the role is no longer part of the name.
-- Safe to run more than once. Only rows still carrying the old seed names are changed.

update members set name = 'Alex'   where name = 'Alex PM';
update members set name = 'Ben'    where name = 'Bao PO';
update members set name = 'Chloe'  where name = 'Chi BA';
update members set name = 'Daniel' where name = 'Dung Designer';
update members set name = 'Emma'   where name = 'Em FE';
update members set name = 'Frank'  where name = 'Phong BE';
update members set name = 'Grace'  where name = 'Giang QC';
