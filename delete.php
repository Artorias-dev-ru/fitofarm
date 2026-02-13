<?php
$token = "dev123"; 
$db_map = [
    'callcenter' => '/root/fitofarm/callcenter/db_store/callcenter.sqlite',
    'fitofarm'   => '/root/fitofarm/fitopharm/db_store/database.sqlite'
];

$base = $_GET['base'] ?? '';
$dt   = $_GET['date'] ?? '';
$t    = $_GET['t'] ?? '';

if (!$base || !$dt || !$t) die('err_params');
if ($t !== $token) die('auth_err');
if (!isset($db_map[$base])) die('db_not_found');

$d = implode('-', array_reverse(explode('-', $dt)));

try {
    $s = new PDO("sqlite:" . $db_map[$base]);
    $tbl = ($base === 'callcenter') ? 'Calls' : 'Dialogs';

    $stmt = $s->prepare("DELETE FROM $tbl WHERE date = ?");
    $stmt->execute([$d]);
    $num = $stmt->rowCount();

    $s->exec("DELETE FROM $tbl WHERE date IS NULL OR date = '' OR date = 'Invalid date'");
    $s->exec("VACUUM");

    echo "ok|{$base}|{$tbl}|{$d}|del:{$num}";
} catch (Exception $e) {
    die('db_err');
}