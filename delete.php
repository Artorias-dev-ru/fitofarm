<?php
$token = "dev123"; 
$db_map = [
    'callcenter' => '/root/fitofarm/callcenter/db_store/callcenter.sqlite',
    'fitofarm'   => '/root/fitofarm/fitopharm/db_store/database.sqlite'
];

$p = explode('/', trim($_SERVER['PATH_INFO'], '/'));
if (count($p) < 3) die('err_params');

list($base, $dt, $t) = $p;

if ($t !== $token) die('auth_err');
if (!isset($db_map[$base])) die('db_not_found');

$d = implode('-', array_reverse(explode('-', $dt)));

try {
    $s = new PDO("sqlite:" . $db_map[$base]);
    
    $q = $s->query("SELECT name FROM sqlite_master WHERE name IN ('Dialogs','Dialogues') LIMIT 1");
    $tbl = $q->fetchColumn();
    
    if (!$tbl) die('no_table');

    $stmt = $s->prepare("DELETE FROM $tbl WHERE date = ?");
    $stmt->execute([$d]);
    $num = $stmt->rowCount();

    $s->exec("DELETE FROM $tbl WHERE date IS NULL OR date = '' OR date = 'Invalid date'");
    
    $s->exec("VACUUM");

    echo "ok|{$base}|{$tbl}|{$d}|del:{$num}";

} catch (Exception $e) {
    die('db_err');
}