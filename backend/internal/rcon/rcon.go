// Package rcon 實作 Source RCON 協定 (Palworld 專用伺服器相容)。
// 僅使用標準函式庫。
package rcon

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"time"
)

const (
	typeAuth          = 3 // SERVERDATA_AUTH
	typeExecCommand   = 2 // SERVERDATA_EXECCOMMAND
	typeAuthResponse  = 2 // SERVERDATA_AUTH_RESPONSE
	typeResponseValue = 0 // SERVERDATA_RESPONSE_VALUE

	maxPacketSize = 4096
)

// Client 是單一 RCON 連線。
type Client struct {
	conn      net.Conn
	reader    *bufio.Reader
	requestID int32
}

// Dial 建立 TCP 連線並完成認證。
func Dial(host string, port int, password string, timeout time.Duration) (*Client, error) {
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return nil, fmt.Errorf("連線 RCON %s 失敗: %w", addr, err)
	}
	c := &Client{conn: conn, reader: bufio.NewReader(conn), requestID: 0}
	_ = conn.SetDeadline(time.Now().Add(timeout))

	if err := c.auth(password); err != nil {
		conn.Close()
		return nil, err
	}
	return c, nil
}

func (c *Client) auth(password string) error {
	id := c.nextID()
	if err := c.writePacket(id, typeAuth, password); err != nil {
		return fmt.Errorf("送出認證封包失敗: %w", err)
	}
	// 伺服器可能先回一個空的 RESPONSE_VALUE，再回 AUTH_RESPONSE。
	for {
		respID, respType, _, err := c.readPacket()
		if err != nil {
			return fmt.Errorf("讀取認證回應失敗: %w", err)
		}
		if respType == typeAuthResponse {
			if respID == -1 {
				return errors.New("RCON 認證失敗：密碼錯誤 (請確認 AdminPassword 與 config.json 的 rcon.password 相同)")
			}
			return nil
		}
	}
}

// Exec 送出一條指令並回傳伺服器回應字串。
func (c *Client) Exec(command string) (string, error) {
	id := c.nextID()
	if err := c.writePacket(id, typeExecCommand, command); err != nil {
		return "", fmt.Errorf("送出指令失敗: %w", err)
	}
	_, _, body, err := c.readPacket()
	if err != nil {
		return "", fmt.Errorf("讀取指令回應失敗: %w", err)
	}
	return body, nil
}

// Close 關閉連線。
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

func (c *Client) nextID() int32 {
	c.requestID++
	return c.requestID
}

func (c *Client) writePacket(id, packetType int32, body string) error {
	payload := make([]byte, 0, len(body)+10)
	var idBuf [4]byte
	var typeBuf [4]byte
	binary.LittleEndian.PutUint32(idBuf[:], uint32(id))
	binary.LittleEndian.PutUint32(typeBuf[:], uint32(packetType))
	payload = append(payload, idBuf[:]...)
	payload = append(payload, typeBuf[:]...)
	payload = append(payload, []byte(body)...)
	payload = append(payload, 0x00, 0x00) // body 結尾 null + 封包結尾 null

	var lenBuf [4]byte
	binary.LittleEndian.PutUint32(lenBuf[:], uint32(len(payload)))

	if _, err := c.conn.Write(lenBuf[:]); err != nil {
		return err
	}
	if _, err := c.conn.Write(payload); err != nil {
		return err
	}
	return nil
}

func (c *Client) readPacket() (id, packetType int32, body string, err error) {
	var lenBuf [4]byte
	if _, err = readFull(c.reader, lenBuf[:]); err != nil {
		return 0, 0, "", err
	}
	length := binary.LittleEndian.Uint32(lenBuf[:])
	if length < 10 || length > maxPacketSize {
		return 0, 0, "", fmt.Errorf("封包長度異常: %d", length)
	}
	buf := make([]byte, length)
	if _, err = readFull(c.reader, buf); err != nil {
		return 0, 0, "", err
	}
	id = int32(binary.LittleEndian.Uint32(buf[0:4]))
	packetType = int32(binary.LittleEndian.Uint32(buf[4:8]))
	// body 從第 8 個 byte 到倒數兩個 null 之前。
	bodyBytes := buf[8:]
	if n := len(bodyBytes); n >= 2 {
		bodyBytes = bodyBytes[:n-2]
	}
	return id, packetType, string(bodyBytes), nil
}

func readFull(r *bufio.Reader, buf []byte) (int, error) {
	total := 0
	for total < len(buf) {
		n, err := r.Read(buf[total:])
		total += n
		if err != nil {
			return total, err
		}
	}
	return total, nil
}

// Send 是便利函式：連線、認證、送一條指令、關閉。
func Send(host string, port int, password, command string, timeout time.Duration) (string, error) {
	c, err := Dial(host, port, password, timeout)
	if err != nil {
		return "", err
	}
	defer c.Close()
	return c.Exec(command)
}
