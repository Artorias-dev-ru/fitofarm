import ftplib

# Данные подключения
FTP_HOST = "isp1.flyanapa.ru"
FTP_PORT = 2222
FTP_USER = "dev"
FTP_PASS = "A1234567"

try:
    ftp = ftplib.FTP()
    print(f"Подключение к {FTP_HOST}...")
    ftp.connect(FTP_HOST, FTP_PORT)
    ftp.login(FTP_USER, FTP_PASS)
    
    # Включаем пассивный режим
    ftp.set_pasv(False)
    
    print("Авторизация успешна. Список файлов:")
    # Получаем список файлов
    files = ftp.nlst()
    for file in files:
        print(f" -> {file}")
        
    ftp.quit()
except Exception as e:
    print(f"Ошибка подключения: {e}")