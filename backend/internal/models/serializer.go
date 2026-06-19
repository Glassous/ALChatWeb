package models

import (
	"context"
	"fmt"
	"reflect"

	"go.mongodb.org/mongo-driver/bson/primitive"
	"gorm.io/gorm/schema"
)

type ObjectIDSerializer struct{}

func (ObjectIDSerializer) Scan(ctx context.Context, field *schema.Field, dst reflect.Value, dbValue interface{}) error {
	if dbValue == nil {
		field.ReflectValueOf(ctx, dst).Set(reflect.ValueOf(primitive.NilObjectID))
		return nil
	}

	var strVal string
	switch v := dbValue.(type) {
	case []byte:
		strVal = string(v)
	case string:
		strVal = v
	default:
		return fmt.Errorf("failed to scan ObjectID: unsupported type %T", dbValue)
	}

	if len(strVal) == 0 {
		field.ReflectValueOf(ctx, dst).Set(reflect.ValueOf(primitive.NilObjectID))
		return nil
	}

	oid, err := primitive.ObjectIDFromHex(strVal)
	if err != nil {
		return err
	}

	field.ReflectValueOf(ctx, dst).Set(reflect.ValueOf(oid))
	return nil
}

func (ObjectIDSerializer) Value(ctx context.Context, field *schema.Field, dst reflect.Value, fieldValue interface{}) (interface{}, error) {
	oid, ok := fieldValue.(primitive.ObjectID)
	if !ok {
		// Try pointer
		if oidPtr, ok := fieldValue.(*primitive.ObjectID); ok {
			if oidPtr == nil || oidPtr.IsZero() {
				return nil, nil
			}
			return oidPtr.Hex(), nil
		}
		return nil, fmt.Errorf("failed to value ObjectID: invalid type %T", fieldValue)
	}
	if oid.IsZero() {
		return nil, nil
	}
	return oid.Hex(), nil
}

func init() {
	schema.RegisterSerializer("objectid", ObjectIDSerializer{})
}
type NullObjectIDSerializer struct{}

func (NullObjectIDSerializer) Scan(ctx context.Context, field *schema.Field, dst reflect.Value, dbValue interface{}) error {
	if dbValue == nil {
		var nilPtr *primitive.ObjectID
		field.ReflectValueOf(ctx, dst).Set(reflect.ValueOf(nilPtr))
		return nil
	}

	var strVal string
	switch v := dbValue.(type) {
	case []byte:
		strVal = string(v)
	case string:
		strVal = v
	default:
		return fmt.Errorf("failed to scan NullObjectID: unsupported type %T", dbValue)
	}

	if len(strVal) == 0 {
		var nilPtr *primitive.ObjectID
		field.ReflectValueOf(ctx, dst).Set(reflect.ValueOf(nilPtr))
		return nil
	}

	oid, err := primitive.ObjectIDFromHex(strVal)
	if err != nil {
		return err
	}

	field.ReflectValueOf(ctx, dst).Set(reflect.ValueOf(&oid))
	return nil
}

func (NullObjectIDSerializer) Value(ctx context.Context, field *schema.Field, dst reflect.Value, fieldValue interface{}) (interface{}, error) {
	if fieldValue == nil {
		return nil, nil
	}
	oidPtr, ok := fieldValue.(*primitive.ObjectID)
	if !ok {
		// Try non-pointer
		if oid, ok := fieldValue.(primitive.ObjectID); ok {
			if oid.IsZero() {
				return nil, nil
			}
			return oid.Hex(), nil
		}
		return nil, fmt.Errorf("failed to value NullObjectID: invalid type %T", fieldValue)
	}
	if oidPtr == nil || oidPtr.IsZero() {
		return nil, nil
	}
	return oidPtr.Hex(), nil
}

func init() {
	schema.RegisterSerializer("nullobjectid", NullObjectIDSerializer{})
}
