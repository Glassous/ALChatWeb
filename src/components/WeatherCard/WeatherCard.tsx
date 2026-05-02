import './WeatherCard.css';

export interface WeatherData {
  location: string;
  current: {
    temp: number;
    feels_like: number;
    humidity: number;
    condition: string;
    wind_speed: number;
    wind_direction: number;
    precipitation: number;
    cloud_cover: number;
  };
  forecast: Array<{
    date: string;
    high: number;
    low: number;
    condition: string;
    precipitation?: number;
    wind_speed_max?: number;
  }>;
}

const conditionIcons: Record<string, string> = {
  '晴': '☀️',
  '多云': '⛅',
  '雾': '🌫️',
  '毛毛雨': '🌦️',
  '雨': '🌧️',
  '雪': '🌨️',
  '阵雨': '⛈️',
  '阵雪': '🌨️',
  '雷暴': '⛈️',
  '未知': '❓',
};

const windDirectionText = (deg: number): string => {
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  const index = Math.round(deg / 45) % 8;
  return dirs[index];
};

const formatDate = (dateStr: string): string => {
  try {
    const date = new Date(dateStr);
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = weekdays[date.getDay()];
    return `${month}/${day} ${weekday}`;
  } catch {
    return dateStr;
  }
};

const isToday = (dateStr: string): boolean => {
  try {
    const date = new Date(dateStr);
    const today = new Date();
    return date.toDateString() === today.toDateString();
  } catch {
    return false;
  }
};

export function WeatherCard({ data }: { data: WeatherData }) {
  const { location, current, forecast } = data;
  const icon = conditionIcons[current.condition] || '❓';

  return (
    <div className="weather-card">
      <div className="weather-current">
        <div className="weather-location">
          <span className="weather-location-icon">📍</span>
          <span>{location}</span>
        </div>
        <div className="weather-main">
          <span className="weather-icon-large">{icon}</span>
          <div className="weather-temp-group">
            <span className="weather-temp">{Math.round(current.temp)}°</span>
            <span className="weather-condition">{current.condition}</span>
          </div>
        </div>
        <div className="weather-details">
          <div className="weather-detail-item">
            <span className="detail-label">体感</span>
            <span className="detail-value">{Math.round(current.feels_like)}°</span>
          </div>
          <div className="weather-detail-item">
            <span className="detail-label">湿度</span>
            <span className="detail-value">{current.humidity}%</span>
          </div>
          <div className="weather-detail-item">
            <span className="detail-label">风向</span>
            <span className="detail-value">{windDirectionText(current.wind_direction)}风 {current.wind_speed}km/h</span>
          </div>
          {current.precipitation > 0 && (
            <div className="weather-detail-item">
              <span className="detail-label">降水</span>
              <span className="detail-value">{current.precipitation}mm</span>
            </div>
          )}
          <div className="weather-detail-item">
            <span className="detail-label">云量</span>
            <span className="detail-value">{current.cloud_cover}%</span>
          </div>
        </div>
      </div>
      {forecast.length > 0 && (
        <div className="weather-forecast">
          <div className="forecast-header">未来天气</div>
          <div className="forecast-list">
            {forecast.map((day, i) => {
              const dayIcon = conditionIcons[day.condition] || '❓';
              const label = isToday(day.date) ? '今天' : formatDate(day.date);
              return (
                <div key={i} className="forecast-item">
                  <span className="forecast-date">{label}</span>
                  <span className="forecast-icon">{dayIcon}</span>
                  <span className="forecast-condition">{day.condition}</span>
                  <span className="forecast-temp">
                    <span className="temp-high">{Math.round(day.high)}°</span>
                    <span className="temp-sep">/</span>
                    <span className="temp-low">{Math.round(day.low)}°</span>
                  </span>
                  {day.precipitation !== undefined && day.precipitation > 0 && (
                    <span className="forecast-precip">💧{day.precipitation}mm</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
